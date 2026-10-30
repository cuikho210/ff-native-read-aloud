import { expect, test } from "bun:test";
import { splitIntoParagraphs } from "../src/content_script";

test("splits on blank lines and trims", () => {
  expect(splitIntoParagraphs("  one  \n\n two \n\n\n")).toEqual(["one", "two"]);
});

test("keeps single newlines inside a paragraph", () => {
  expect(splitIntoParagraphs("line one\nline two\n\nnext")).toEqual([
    "line one\nline two",
    "next",
  ]);
});

test("drops empty input", () => {
  expect(splitIntoParagraphs(" \n\n ")).toEqual([]);
});
