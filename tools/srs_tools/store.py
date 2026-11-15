"""Read the current card metadata generation without native dependencies."""
def partition_paths(manifest):
    if "partition_count" in manifest:
        count = manifest["partition_count"]
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("Invalid card partition count")
        return [f"imports/{manifest['revision']}/cards-{index:05d}.json" for index in range(count)]
    return manifest["partitions"]


