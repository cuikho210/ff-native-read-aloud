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
            MODEL="gemini-2.0-flash"
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
                \"role\": \"user\",
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

        read -p "Do you accept this commit message? (y/n): " confirm
        case $confirm in
            [Yy]*)
                git commit -S -m "$commit_msg"
                exit 0
                ;;
            [Nn]*) echo "Retrying..." ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

system_message=$(cat <<'EOF' | jq -Rs .
# Generate a concise Git commit message following the Conventional Commits format:

```
<type>(<scope>): <description>
```

## **Types**
The **type** indicates the purpose of the change. Here are the most common ones:

- **`feat`**: Adds a new feature (e.g., a new button or endpoint).
- **`fix`**: Resolves a bug.
- **`docs`**: Updates documentation (e.g., README or API docs).
- **`style`**: Adjusts code formatting without changing logic (e.g., indentation).
- **`refactor`**: Reworks code without adding features or fixing bugs.
- **`test`**: Adds or improves tests.
- **`chore`**: Handles minor updates (e.g., dependency bumps).
- **`perf`**: Enhances performance.
- **`ci`**: Modifies CI/CD processes (e.g., GitHub Actions).
- **`build`**: Updates build tools or configurations.

## **Scope**
- **Optional**: Use it to specify the **part of the project** affected (e.g., `auth`, `ui`, `db`).
- **Purpose**: Adds context and aids automation.
- **Examples**: `feat(auth)` for authentication changes, `fix(ui)` for UI fixes.
- **When to skip**: If the change impacts the whole project or no specific area.
- **Tip**: Use consistent scope names across your project.

## **Strong File-Scoping**
- **File Emphasis**: ALWAYS use filename as scope when single-file changes are detected.
- **Multi-file changes**: Group files logically by feature/component names.
- **Example**: `fix(config.json)` instead of just `fix(config)`.
- **Stricter Rule**: Keep filenames in scope, even when broader categorization exists.
- **Git Diff Guidance**: Base scope on exact filenames shown in diff.

## **Rules**
- **Present tense**: Write "add" instead of "added".
- **No period**: Keep it concise (e.g., "fix bug" not "fix bug.").
- **Lowercase start**: Begin with a lowercase letter (e.g., "update config").
- **Short first line**: Aim for under 72 characters.
- **Breaking changes**: Add `BREAKING CHANGE:` for incompatible updates.
- **Body**: Add details after a blank line if needed.
- **Footer**: Include notes like "Fixes #123" or breaking change info.

## **Examples**
Here are practical examples for various cases:

1. **Simple Fix**:
```
fix(ui): adjust button padding
```

2. **Feature with Details**:
```
feat(api): add user profile endpoint

- Implement GET /users/:id
- Add validation for user ID
- Return 404 if user not found
```

3. **Breaking Change**:
```
feat(db): switch to MongoDB 6.0

- Update connection string format
- Drop support for legacy queries
BREAKING CHANGE: Requires MongoDB 6.0+
```

4. **Minor Update**:
```
chore(deps): update lodash to 4.17.21
```

5. **Performance Boost**:
```
perf: cache database query results
```

6. **CI Change**:
```
ci: configure linting on pull requests
```

RETURNS ONLY THE COMMIT CONTENT WITHOUT ANY OTHER CONTENT.

EOF
)

main "$@"
