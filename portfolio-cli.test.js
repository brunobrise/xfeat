const { parsePortfolioArgs } = require("./lib/portfolio-cli");

describe("Portfolio CLI arguments", () => {
  it("parses positional paths, repeated globs, and --flag=value forms", () => {
    expect(
      parsePortfolioArgs([
        "scan",
        "../api",
        "--include",
        "billing-*",
        "--include=ledger",
        "--out=docs/portfolio",
        "--render-diagrams",
      ]),
    ).toEqual({
      command: "scan",
      options: {
        paths: ["../api"],
        include: ["billing-*", "ledger"],
        exclude: [],
        out: "docs/portfolio",
        renderDiagrams: true,
      },
    });
  });

  it("rejects missing values, unknown options, and options a command ignores", () => {
    expect(() => parsePortfolioArgs(["scan", "--out"])).toThrow(
      "--out requires a value",
    );
    expect(() => parsePortfolioArgs(["scan", "--out", "--from"])).toThrow(
      "--out requires a value",
    );
    expect(() => parsePortfolioArgs(["scan", "--bogus"])).toThrow(
      "Unknown option --bogus",
    );
    expect(() => parsePortfolioArgs(["verify", "--render-diagrams"])).toThrow(
      "--render-diagrams does not apply to portfolio verify",
    );
    expect(() => parsePortfolioArgs(["verify", "../api"])).toThrow(
      "portfolio verify does not take repository paths",
    );
  });
});
