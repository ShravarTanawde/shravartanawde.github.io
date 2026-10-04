from pipeline.lineage import compute


def assign(groups):
    return {f"p{k}": t for t, ks in groups.items() for k in ks}


def test_continues_split_merged_and_new():
    old = assign({"a": range(0, 50), "b": range(50, 100), "c": range(100, 120), "d": range(120, 140), None: range(140, 170)})
    new = assign({
        "x": range(0, 48),                               # a, kept almost whole
        "y": list(range(50, 75)), "z": list(range(75, 100)),  # b, split in two
        "m": range(100, 140),                            # c and d, merged
        "n": range(140, 170),                            # unassigned before
    })
    out = compute(new, old)
    assert out["x"] == {"kind": "continues", "from": ["a"]}
    assert out["y"] == {"kind": "split", "from": ["b"]} and out["z"] == {"kind": "split", "from": ["b"]}
    assert out["m"]["kind"] == "merged" and sorted(out["m"]["from"]) == ["c", "d"]
    assert out["n"] == {"kind": "new", "from": []}


def test_an_old_topic_continues_only_once():
    old = assign({"a": range(0, 100)})
    new = assign({"x": range(0, 60), "y": range(60, 100)})
    out = compute(new, old)
    kinds = sorted(v["kind"] for v in out.values())
    assert kinds.count("continues") == 1
