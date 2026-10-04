const { proseFindings } = require("./test_files/prose-lint");

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const rules = (markdown, options) =>
  proseFindings(markdown, options).map((finding) => finding.rule);

describe("STE-lite prose rules", () => {
  it("limits descriptive sentences to 25 words and steps to 20", () => {
    expect(rules(`${words(25)}.`)).toEqual([]);
    expect(rules(`${words(26)}.`)).toEqual(["sentence-length"]);
    expect(rules(`1. Run ${words(19)}.`)).toEqual([]);
    expect(rules(`1. Run ${words(20)}.`)).toEqual(["step-length"]);
    // A numbered question is not a procedure step.
    expect(rules(`1. Which ${words(22)}?`)).toEqual([]);
  });

  it("allows one instruction per step", () => {
    expect(rules("1. Clone `api`. Run `make test`.")).toEqual([
      "one-instruction",
    ]);
    expect(rules("1. Clone `api`, then run `make test`.")).toEqual([
      "one-instruction",
    ]);
    expect(rules("1. Clone `api` and then run `make test`.")).toEqual([
      "one-instruction",
    ]);
  });

  it("limits paragraphs to six sentences", () => {
    const sentence = "One short sentence here.";
    expect(rules(Array(6).fill(sentence).join("\n"))).toEqual([]);
    expect(rules(Array(7).fill(sentence).join("\n"))).toEqual([
      "paragraph-length",
    ]);
    expect(rules(Array(7).fill(sentence).join("\n\n"))).toEqual([]);
  });

  it("rejects semicolons, contractions, and passive voice", () => {
    expect(rules("Links break; check them.")).toEqual(["semicolon"]);
    expect(rules("It doesn't run.")).toEqual(["contraction"]);
    expect(rules("The repository's owner is listed.")).toEqual(["passive"]);
    expect(rules("Commands are copied from CI.")).toEqual(["passive"]);
    expect(
      rules("Commands are copied from CI.", { allow: [/are copied from CI/] }),
    ).toEqual([]);
  });

  // Cases from an independent review of the lint.
  it.each([
    [
      "a step whose colon hides its length",
      `1. Run the tests of each repository that depends on \`x\`: ${words(14)}.`,
      ["step-length"],
    ],
    [
      "a description whose colon hides its length",
      `${words(20)}: ${words(20)}.`,
      ["sentence-length"],
    ],
    [
      "a step joining two actions",
      "1. Clone `api` and run `make test`.",
      ["one-instruction"],
    ],
    [
      "a step continued on the next line",
      "1. Clone `api`.\n   Run `make test`.",
      ["one-instruction"],
    ],
    [
      "a long step on two lines",
      `1. ${words(15)}\n   ${words(15)}.`,
      ["step-length"],
    ],
    [
      "a step with a 1) marker",
      "1) Clone `api`. Run `make test`.",
      ["one-instruction"],
    ],
    [
      "a passive with an adverb",
      "Commands are also copied from CI.",
      ["passive"],
    ],
    [
      "a passive with never",
      "Commands are never executed by xfeat.",
      ["passive"],
    ],
    [
      "an irregular participle",
      "The answer is hidden until you open it.",
      ["passive"],
    ],
    [
      "another irregular participle",
      "Hand edits are overwritten.",
      ["passive"],
    ],
    ["a get passive", "Hand edits get overwritten.", ["passive"]],
    ["a by fragment", "- Required by web.", ["passive"]],
    ["he's", "He's the owner.", ["contraction"]],
    ["where's", "Where's the file?", ["contraction"]],
    ["a modifier-letter apostrophe", "It doesnʼt run.", ["contraction"]],
    [
      "one sentence with e.g.",
      `${words(15)}, e.g. ${words(15)}.`,
      ["sentence-length"],
    ],
  ])("flags %s", (_name, markdown, expected) => {
    expect(rules(markdown)).toEqual(expected);
  });

  it.each([
    ["a step with e.g.", "1. Install a package manager, e.g. `pnpm`."],
    ["a hyphenated adjective", "The output folder is read-only."],
    ["the idiom getting started", "Getting started: clone order and commands."],
    ["another hyphenated adjective", "The command is built-in."],
    ["a short adjective ending in ed", "The badge is red."],
    [
      "plus-marker list items",
      "+ One.\n+ Two.\n+ Three.\n+ Four.\n+ Five.\n+ Six.\n+ Seven.",
    ],
    [
      "labels separated by colons",
      "Read: the index. Read: the landscape. Read: the gaps. Read: the packages.",
    ],
  ])("accepts %s", (_name, markdown) => {
    expect(rules(markdown)).toEqual([]);
  });

  it("skips quoted source text, tables, headings, code, and comments", () => {
    const long = words(30);
    const page = [
      "---",
      `title: ${long}`,
      "---",
      `# ${long}`,
      `> ${long}; it's quoted.`,
      `  > ${long}`,
      `| ${long} | a; b |`,
      "```",
      `${long}; done`,
      "```",
      "<!-- xfeat scan overwrites this file; keep it. -->",
      "Run `a; b && c` now.",
    ].join("\n");
    expect(rules(page)).toEqual([]);
  });
});
