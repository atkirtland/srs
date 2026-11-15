"""Managed-note tags shared by synchronization, migrations, and auditing."""

MANAGED_TAGS = {
    "list": "oa::managed::list",
    "structural": "oa::managed::structural",
    "block": "oa::managed::block",
}

# Recognize the mistaken tags until affected notes have been cleaned up.
MISTAKEN_MANAGED_TAGS = {
    kind: tag.replace("oa::", "os::", 1) for kind, tag in MANAGED_TAGS.items()
}
