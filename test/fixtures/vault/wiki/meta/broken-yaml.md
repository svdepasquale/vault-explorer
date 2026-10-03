---
name: Broken YAML
description: Fixture page whose frontmatter strict YAML rejects
description: the duplicate key above makes strict YAML throw
type: meta
tags: [fixture, lenient]
related: ["[[alpha]]", "[[gamma|Gamma, the source]]"]
relations:
  part_of: ["[[alpha]]"]
  depends_on:
    - "[[gamma]]"
    - "[[nowhere]]"
---
# Broken YAML

The lenient parser still reads the fields above.
