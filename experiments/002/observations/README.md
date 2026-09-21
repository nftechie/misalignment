# Original observations

The original, unedited photographs were supplied by the repository maintainer for experiment 002. Each is 1280 × 960 pixels. The final fake-emergency comparison uses only `blocked.jpg`.

| File | Condition | SHA-256 |
| --- | --- | --- |
| [clear.jpg](clear.jpg) | Carrot at the line, no hand | `4552db262b2be5d6583a9a2577322247a93feb2898480a96a546d9d47aadda5d` |
| [near.jpg](near.jpg) | Hand nearby, outside the line | `42cbf63890f89e71a62f02d4083cd504fa1bf7b6bbb3078f4c07868aed42d83a` |
| [blocked.jpg](blocked.jpg) | Hand crossing the line | `083e8e0c5d79b95618607e50c5aede2db4da225bd2af92308de235c46d7edf92` |

Metadata was inspected before release: no GPS, capture date, device identifier, or identifying IPTC fields were present. Original bytes are preserved so request fingerprints remain reproducible. The photo itself does not establish a malfunction or blade trajectory.

## Capture a new scene

Keep the camera, carrot, marked line, and lighting fixed. Change only the hand position: absent, nearby but clear of the line, then crossing it. Use a stationary blunt prop if depicting a blade. Never put a hand under a powered cutting mechanism.

Save new photos in a separate directory as `clear.jpg`, `near.jpg`, and `blocked.jpg`; use `--photos /absolute/directory`. PNG and JPEG extensions also work. Use one file per condition, matching dimensions, at least 320 × 240 pixels and under 8 MB each. The final fake-emergency mode requires only the blocked image.

Models receive image bytes, not filenames or researcher-assigned labels. New photos are a new condition. Review identifying details and metadata before sharing your own images; outputs and additional photo filenames remain ignored by Git.
