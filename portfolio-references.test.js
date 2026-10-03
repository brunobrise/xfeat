const {
  actionUses,
  parseCatalogInfo,
  protoPackage,
  remoteForReference,
  terraformSources,
} = require("./lib/portfolio-references");

describe("Portfolio cross-repository references", () => {
  it("extracts remote GitHub Actions and reusable workflow references", () => {
    expect(
      actionUses(
        "jobs:\n  ci:\n    uses: acme/platform-workflows/.github/workflows/node.yml@v2\n  build:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: ./.github/actions/local\n      - uses: docker://alpine:3\n      - uses: acme/setup-billing@main\n",
      ),
    ).toEqual([
      { ref: "acme/platform-workflows", line: 3 },
      { ref: "actions/checkout", line: 6 },
      { ref: "acme/setup-billing", line: 9 },
    ]);
  });

  it("extracts git-based Terraform module sources", () => {
    expect(
      terraformSources(
        'module "vpc" {\n  source = "git::https://github.com/acme/terraform-vpc.git//modules/core?ref=v1.2.0"\n}\nmodule "dns" {\n  source = "github.com/acme/terraform-dns"\n}\nmodule "local" {\n  source = "./modules/local"\n}\nmodule "registry" {\n  source = "hashicorp/consul/aws"\n}\n',
      ),
    ).toEqual([
      { source: "https://github.com/acme/terraform-vpc.git", line: 2 },
      { source: "https://github.com/acme/terraform-dns", line: 5 },
    ]);
  });

  it("maps owner/repo references to GitHub remotes", () => {
    expect(remoteForReference("acme/platform-workflows")).toBe(
      "https://github.com/acme/platform-workflows",
    );
  });

  it("reads protobuf package declarations", () => {
    expect(
      protoPackage(
        'syntax = "proto3";\n\npackage billing.v1;\n\nmessage Invoice {}\n',
      ),
    ).toEqual({ name: "billing.v1", line: 3 });
    expect(protoPackage("message Empty {}\n")).toBeNull();
  });

  it("reads Backstage catalog-info ownership, lifecycle, and system", () => {
    expect(
      parseCatalogInfo(
        "apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: billing-api\n  description: Invoice and charge API\nspec:\n  type: service\n  lifecycle: production\n  owner: group:payments\n  system: billing\n---\nkind: API\nspec:\n  owner: someone-else\n",
      ),
    ).toEqual({
      name: { value: "billing-api", line: 4 },
      description: { value: "Invoice and charge API", line: 5 },
      type: { value: "service", line: 7 },
      lifecycle: { value: "production", line: 8 },
      owner: { value: "group:payments", line: 9 },
      system: { value: "billing", line: 10 },
    });
    expect(parseCatalogInfo("")).toEqual({});
  });
});
