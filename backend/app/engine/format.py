def inr(n) -> str:
    """Format rupees with en-IN grouping, e.g. 1234567 -> Rs 12,34,567 (uses the rupee sign)."""
    if n is None:
        return "-"
    neg = n < 0
    s = str(int(round(abs(n))))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "₹" + s
