#!/usr/bin/bash

cd "$(dirname "$0")"

provider="${DEFAULT_LLM_PROVIDER:-mistral}"
commit_msg=""

function load_provider_config() {
    case $provider in
        "huggingface")
            MODEL="Qwen/Qwen2.5-Coder-32B-Instruct"
            API_URL="https://api-inference.huggingface.co/models/$MODEL/v1/chat/completions"
            AUTH_HEADER="Authorization: Bearer $HF_TOKEN"
            ;;
        "openai")
            MODEL="o3-mini"
            API_URL="https://api.openai.com/v1/chat/completions"
            AUTH_HEADER="Authorization: Bearer $OPENAI_API_KEY"
            ;;
        "gemini")
            MODEL="gemini-2.5-flash-preview-04-17"
            API_URL="https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent"
            AUTH_HEADER="x-goog-api-key: $GEMINI_API_KEY"
            ;;
        "openrouter")
            MODEL="deepseek/deepseek-r1:free"
            API_URL="https://openrouter.ai/api/v1/chat/completions"
            AUTH_HEADER="Authorization: Bearer $OPENROUTER_API_KEY"
            ;;
        "mistral")
            MODEL="pixtral-large-2411"
            API_URL="https://api.mistral.ai/v1/chat/completions"
            AUTH_HEADER="Authorization: Bearer $MISTRAL_API_KEY"
            ;;
        *)
            echo "Invalid provider. Use 'huggingface', 'openai', 'gemini', 'mistral' or 'openrouter'"
            exit 1
            ;;
    esac
}

function parse_args() {
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            -p|--provider) provider="$2"; shift ;;
            -m|--message) commit_msg="$2"; shift ;;
            *) echo "Unknown parameter: $1"; exit 1 ;;
        esac
        shift
    done
}

function get_git_diff() {
    local diff=$(git diff --cached -- . ':(exclude)**/*.lock' ':(exclude)**/*.lockb' | tr -d '\000-\037' | jq -Rs .)
    if [ -z "$diff" ]; then
        echo "No staged changes to commit."
        exit 1
    fi
    echo "$diff"
}

# Get recent 10 commit logs
function get_commit_logs() {
    local logs=$(git log -10 --pretty=format:"%h - %s")
    # Escape double quotes for JSON safely
    echo "$logs" | sed ':a;N;$!ba;s/\n/\\n/g;s/"/\\"/g'
}

function get_commit_message() {
    local git_diff=$1
    local user_msg="${commit_msg:-""}"
    local commit_logs=$(get_commit_logs)

    local json_input=$(jq -n \
        --arg diff "$git_diff" \
        --arg msg "$user_msg" \
        --arg logs "$commit_logs" \
        '"Git diff:\n```\n" + $diff + "\n```\nRecent commits:\n```\n" + $logs + "\n```\nUser message:\n```\n" + $msg + "\n```\n"')

    local response

    if [ "$provider" = "gemini" ]; then
        response=$(call_gemini_api "$json_input")
    else
        response=$(call_default_api "$json_input")
    fi

    local commit_msg=$(extract_commit_message "$response")
    validate_commit_message "$commit_msg" "$response"

    echo "$commit_msg" | sed 's/^"//;s/"$//'
}

function call_gemini_api() {
    local user_msg=$1

    curl -s "$API_URL" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{
            \"contents\": [
                {\"role\": \"user\", \"parts\": [{\"text\": ${user_msg}}]}
            ],
            \"systemInstruction\": {
                \"parts\": [{\"text\": ${system_message}}]
            }
        }"
}

function call_default_api() {
    local user_msg=$1

    curl -s "$API_URL" \
        -X "POST" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -H "x-use-cache: false" \
        -d "{
            \"model\": \"$MODEL\",
            \"messages\": [
                {\"role\": \"system\", \"content\": ${system_message}},
                {\"role\": \"user\", \"content\": ${user_msg}}
            ]
        }"
}

function extract_commit_message() {
    local response=$1
    if [ "$provider" = "gemini" ]; then
        echo "$response" | jq -r '.candidates[0].content.parts[0].text'
    else
        echo "$response" | jq -r '.choices[0].message.content' 2>/dev/null
    fi
}

function validate_commit_message() {
    local commit_msg=$1
    local response=$2
    if [ -z "$commit_msg" ] || [ "$commit_msg" = "null" ]; then
        echo "Error: Empty or null commit message. Full response:" >&2
        echo "$response" >&2
        exit 1
    fi
}

function main() {
    parse_args "$@"
    load_provider_config

    local git_diff=$(get_git_diff)

    while true; do
        local commit_msg=$(get_commit_message "$git_diff")
        echo "---------- Suggested commit message ----------"
        echo "$commit_msg"
        echo "----------------------------------------------"

        read -p "Accept this commit message? (y/n/e to edit): " confirm
        case $confirm in
            [Yy]*)
                git commit -S -m "$commit_msg"
                exit 0
                ;;
            [Ee]*)
                temp_file=$(mktemp)
                echo "$commit_msg" > "$temp_file"

                ${EDITOR:-vim} "$temp_file"

                edited_msg=$(cat "$temp_file")
                rm "$temp_file"

                echo "---------- Edited commit message ----------"
                echo "$edited_msg"
                echo "-------------------------------------------"
                read -p "Commit with this message? (y/n): " edit_confirm
                if [[ $edit_confirm =~ ^[Yy] ]]; then
                    git commit -S -m "$edited_msg"
                    exit 0
                else
                    echo "Retrying..."
                fi
                ;;
            [Nn]*) echo "Retrying..." ;;
            *) echo "Please answer y, n, or e." ;;
        esac
    done
}

# Source: https://github.com/zed-industries/zed/blob/main/crates/git_ui/src/commit_message_prompt.txt
system_message=$(cat <<'EOF' | jq -Rs .
You are an expert at writing Git commits. Your job is to write a short clear commit message that summarizes the changes.

If you can accurately express the change in just the subject line, don't include anything in the message body. Only use the body when it is providing *useful* information.

Don't repeat information from the subject line in the message body.

Only return the commit message in your response. Do not include any additional meta-commentary about the task. Do not include the raw diff output in the commit message.

Follow good Git style:

- Separate the subject from the body with a blank line
- Try to limit the subject line to 50 characters
- Do not capitalize the title line
- Do not end the subject line with any punctuation
- Use the imperative mood in the subject line
- Wrap the body at 72 characters
- Keep the body short and concise (omit it entirely if not useful)
EOF
)

main "$@"
