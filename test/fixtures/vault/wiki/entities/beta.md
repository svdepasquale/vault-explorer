---
name: Beta
description: Fixture entity that hosts alpha
type: entity
tags: [fixture]
related: ["[[rotate]]"]
relations:
  hosts: ["[[alpha]]"]
  depends_on: ["[[gamma]]"]
---
# Beta

Beta reads its configuration from [[sources/gamma|the gamma source]].
Back to the [[_index]].

## Operations

- Restart with the [[rotate]] runbook.
