---
date: 2026-10-04
status: decided
decision: Graven
related_specs:
  - ../specs/01a108ce87cf7694-graven-rename.md
---

# Product Name Research

## Question

`xfeat` means "extract features". That describes the first version of the
tool: an LLM pipeline that writes a feature map. The product grew past that.
Its distinctive parts are now deterministic: generated pages pin every claim
to a file, line, and commit, `verify` and `ci` fail when a cited line changes,
and `portfolio` documents many repositories as one system. The name no longer
says what the product does or who buys it.

This document records how a new name was chosen, which candidates failed and
why, and what is still unchecked. Open it before changing the name, the
tagline, or the brand vocabulary.

## Requirements

The owner set these requirements one at a time while reviewing candidates. A
name that fails one is out.

1. Marketable and iconic.
2. Easy to remember and catchy.
3. Related to "code is law" and to storytelling.
4. Bold, not descriptive.
5. Credible to enterprise buyers.
6. Free of conflicts with an existing software brand, with an npm name and a
   usable domain.

## Positioning behind the name

The name has to carry one claim: these docs are evidence, not paraphrase.
"AI documentation" is a crowded category (Mintlify, Swimm, DeepWiki,
Greptile). "Documentation where every claim cites its source and CI fails on
drift" has no strong owner. The name, tagline, and vocabulary all serve that
claim.

The phrase "code is law" is used as a tagline only. Since 2016 it reads as
Ethereum culture, so a name built on it would signal a crypto tool.

## Candidates and verdicts

Rounds are in the order they ran. Availability was checked on 2026-10-04 with
`npm view <name>` and `dig +short NS <domain>`. A domain with no nameservers
is only probably unregistered; a registrar search is the only proof.

| Round | Candidate                                         | Verdict                | Reason                                                                                                                         |
| ----- | ------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Plumb                                             | Rejected               | "Plumb line" is a niche idiom, the sound is flat, and it suggests plumbing.                                                    |
| 2     | Sworn                                             | Rejected               | Clear promise ("docs under oath"), but legal and cold, and not a verb.                                                         |
| 2     | Cite, Receipts, Vouch                             | Rejected               | Generic, plural, or taken in developer tools (vouch-proxy).                                                                    |
| 3     | Lore                                              | Rejected               | Catchy, but implies myth, the opposite of evidence.                                                                            |
| 3     | Canon                                             | Rejected               | Best meaning (story canon and canon law), but Canon Inc. defends the mark and owns `canon.sh`; search returns printer manuals. |
| 3     | Codex                                             | Rejected               | "Code" comes from codex, but OpenAI Codex owns it in developer tools.                                                          |
| 3     | Testament                                         | Runner-up              | Law, story, and "test" in one word, but long to type.                                                                          |
| 4     | Hammurabi                                         | Kept as origin story   | Bold and memorable, but long, often misspelled, and evokes punishment. Fails the enterprise requirement.                       |
| 4     | Emet, Gospel                                      | Rejected               | Emet needs its story told first; Gospel carries religious risk.                                                                |
| 5     | Stela                                             | Chosen, then withdrawn | See below.                                                                                                                     |
| 5     | Solon                                             | Backup                 | Lawgiver who wrote his laws as poetry; most domains taken, sounds like Solana.                                                 |
| 6     | Homer, Aesop, Shakespeare, Kafka, Tolkien, Asimov | Rejected               | Famous storytellers are famous brands already: Simpsons, Aesop skincare, Google Bard, Apache Kafka, active estates.            |
| 6     | Vyasa                                             | Rejected               | Best legend fit, but unknown to most Western buyers and a revered religious figure.                                            |
| 7     | Basalt, Etch, Engrave, Hewn, Litho, Lithic        | Rejected               | npm names taken and almost no open domains.                                                                                    |
| 7     | Carven                                            | Rejected               | Carven is a Paris fashion house.                                                                                               |
| 7     | Cuneo                                             | Backup                 | All checked domains open and npm free, but the link to cuneiform needs explaining.                                             |
| 7     | **Graven**                                        | **Chosen**             | See below.                                                                                                                     |

## Why Stela was withdrawn

Stela, the carved stone that holds a law, fit every requirement in review.
The final conflict check found an existing product with the same name in the
same market:

- STELA is a no-code test automation and RPA platform by Software Testing
  Bureau (Montevideo, 20 years in software quality, enterprise clients), at
  `stela.ai`. It is listed on
  [G2](https://www.g2.com/products/stela/discuss),
  [Capterra](https://www.capterra.com.au/software/1042193/stela), and
  [GetApp](https://www.getapp.com/it-management-software/a/stela/).
- Both products sell software-quality tooling to engineering teams, so buyers
  could confuse them and a trademark claim would be likely to succeed.

The earlier domain checks had missed it because they looked at `.com`, `.dev`,
and `.sh` only. The `.ai` page title gave it away.

## Why Graven

Graven is the old past participle of "grave", to carve into stone (Old English
_grafan_). "Graven in stone" means permanent and beyond argument.

- **Code is law:** the law is graven; so are the docs, from the code.
- **Storytelling:** the origin story is Hammurabi's law code, graven on a
  basalt stela around 1754 BC with a carved scene, a prologue, the laws, and an
  epilogue. Law and story on one stone.
- **Catchy:** two syllables, a real word, rhymes with raven.
- **Enterprise:** "grave" carries gravitas; the word sounds solid in a buying
  committee.
- **Availability (2026-10-04):** npm `graven` is free. `graven.sh`,
  `graven.so`, `getgraven.com`, `usegraven.com`, `gravenhq.com`, and
  `gravendocs.com` had no nameservers. A web search found no software company
  named Graven, only similar names (Graveco, Gravelsoft, Gravit).

Known risks:

- "Grave" can read as death. The brand voice uses "graven" and "carved",
  never "grave".
- "Graven image" is a Biblical term. Do not use the phrase.
- _Graven_ is a 2024 video game. Games are in Nice class 9, like software,
  but sold to a different market.

## Origin story facts

The Law Code of Hammurabi is a basalt stela, 225 cm tall, inventory Sb 8 at the
Louvre. A French mission found it at Susa in the winter of 1901 to 1902. The top
shows Hammurabi before Shamash, the sun god and god of justice
([Ministère de la Culture](https://archeologie.culture.gouv.fr/jacques-morgan/en/media/view/3496),
[Wikipedia](https://en.wikipedia.org/wiki/Code_of_Hammurabi)).

## Still unchecked

- Trademark searches for "Graven" in classes 9 and 42 at EUIPO, USPTO, and INPI.
- Registrar confirmation and registration of `graven.sh` and `gravenhq.com`.
- The npm `@graven` scope and the GitHub organization.
