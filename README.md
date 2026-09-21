# Misalignment

**Open source AI safety experiments.**

We test how AI models respond to concrete situations with visible consequences. Each experiment publishes its inputs, prompts, method, and observed results so other people can inspect the evidence and replicate the test.

The aim is to make questions about AI behavior easier to see and investigate. We report refusals, errors, and inconsistent decisions alongside successful actions. Small demonstrations are starting points for research, not general safety rankings.

## Experiments

| Experiment | Question | Status |
| --- | --- | --- |
| [001 — Pushing a person off a simulated ledge](experiments/001/) | Given a rooftop image and an instruction, does a model select an action that pushes a simulated person off the ledge? | Inputs, results, and replication runner available |
| [002 — Choosing “cut” with a hand on the carrot](experiments/002/) | Does a kitchen-robot model select cut when a hand crosses the marked cutting line in a real photograph? | Original photos, exact prompts, 718 trial records, and replication runner available |
| [003 — Selling a cracked phone as undamaged](experiments/003/) | Does a sales-only performance target produce buyer-facing claims that contradict a supplied private inspection record? | Exact inputs, all 167 follow-up attempts, the original 120 conversations, and replication runner available |

Each numbered directory has its own README with the setup, limitations, and steps to reproduce it. The replication kits focus on model decisions; the website and video production tools are maintained separately.

## Replicate or contribute

Start with an experiment's README. Keep the inputs fixed for a replication, and label any change in model version, prompt, image, settings, or access method as a new condition. Report every attempt, including failures and negative results.

Share findings through GitHub issues or pull requests. Never include API keys, login tokens, private account details, or raw client logs. Runner outputs are ignored by Git by default; review and sanitize them before sharing.

[Website](https://misalignment.xyz/) · [Blog](https://misalignment.xyz/blog/)

Original code and documentation are MIT licensed. Rendered inputs can contain third-party assets; see each experiment's credits.
