// AUTO-GENERATED from the agent prep artifacts (colors stripped). Display-only reference data.
export const PATTERNS = [
  {
    "id": "hashmap",
    "name": "Hash Map / Frequency",
    "icon": "⊞",
    "tags": [
      "O(n)",
      "lookup",
      "counting",
      "prefix-sum"
    ],
    "description": "Trade O(n²) naive lookups for O(n) single-pass solutions. Two variants: direct lookup (complement/pair finding) and frequency counting. Prefix sum + map is the most powerful form.",
    "when": [
      "Two Sum / pair finding — 'find two elements that sum to k'",
      "Anagram / frequency comparison — 'same characters?'",
      "Subarray with target sum → prefix sum + map",
      "Group by property — group anagrams, find duplicates"
    ],
    "template": "# Direct lookup\nseen = {}\nfor i, x in enumerate(arr):\n    complement = target - x\n    if complement in seen:\n        return [seen[complement], i]\n    seen[x] = i\n\n# Prefix sum + map (subarray sum = k)\ncount = {0: 1}  # critical: init before loop\nprefix = 0\nresult = 0\nfor x in arr:\n    prefix += x\n    result += count.get(prefix - k, 0)\n    count[prefix] = count.get(prefix, 0) + 1",
    "keyProblems": [
      {
        "name": "Two Sum",
        "num": 1,
        "note": "Store complement in map as you iterate."
      },
      {
        "name": "Subarray Sum Equals K",
        "num": 560,
        "note": "THE prefix sum pattern. count[0]=1 init is critical."
      },
      {
        "name": "Group Anagrams",
        "num": 49,
        "note": "Key = sorted string or tuple(char counts)."
      },
      {
        "name": "Top K Frequent Elements",
        "num": 347,
        "note": "Freq map → min-heap of size k. Or bucket sort O(n)."
      }
    ],
    "gotchas": [
      "Prefix sum: always initialize count[0] = 1 before the loop",
      "Two Sum: build the map as you go — don't build upfront (avoids matching element with itself)",
      "For streaming top-K: Count-Min Sketch exists; heap+map is good enough for interview"
    ]
  },
  {
    "id": "heap",
    "name": "Heap / Priority Queue",
    "icon": "△",
    "tags": [
      "min-heap",
      "max-heap",
      "top-k",
      "O(n log k)",
      "k-way-merge"
    ],
    "description": "A heavily tested pattern. Use when you need repeated min/max access. The k-way merge pattern (seeding a heap with the first element of each sorted source) is fundamental to external sorting and log/file compaction.",
    "when": [
      "Top K elements (frequent, largest) → min-heap of size k",
      "Merge K sorted sources → heap with (val, source_idx)",
      "Median from stream → two heaps (max-heap lower, min-heap upper)",
      "Streaming aggregation with memory budget → size-bounded heap"
    ],
    "template": "import heapq\n\n# Min-heap of size k (top-k largest)\nheap = []\nfor x in arr:\n    heapq.heappush(heap, x)\n    if len(heap) > k:\n        heapq.heappop(heap)\nreturn heap[0]  # kth largest\n\n# K-way merge (core external-sort pattern)\n# lists = [[sorted chunk 0], [sorted chunk 1], ...]\nheap = []\nfor i, lst in enumerate(lists):\n    if lst:\n        heapq.heappush(heap, (lst[0], i, 0))\nresult = []\nwhile heap:\n    val, i, j = heapq.heappop(heap)\n    result.append(val)\n    if j + 1 < len(lists[i]):\n        heapq.heappush(heap, (lists[i][j+1], i, j+1))\n\n# Two heaps for streaming median\nlower = []  # max-heap (negate)\nupper = []  # min-heap\ndef add(num):\n    heapq.heappush(lower, -num)\n    heapq.heappush(upper, -heapq.heappop(lower))\n    if len(upper) > len(lower):\n        heapq.heappush(lower, -heapq.heappop(upper))\ndef median():\n    if len(lower) > len(upper): return -lower[0]\n    return (-lower[0] + upper[0]) / 2",
    "keyProblems": [
      {
        "name": "Merge K Sorted Lists",
        "num": 23,
        "note": "Include list idx in tuple for stable comparison. Direct k-way merge."
      },
      {
        "name": "Find Median from Data Stream",
        "num": 295,
        "note": "Two heaps. lower always has >= elements. Rebalance after each insert."
      },
      {
        "name": "Kth Largest Element",
        "num": 215,
        "note": "Min-heap size k. Also know quickselect O(n) avg."
      },
      {
        "name": "Sliding Window Maximum",
        "num": 239,
        "note": "Monotonic deque — remove smaller elements from back."
      }
    ],
    "gotchas": [
      "K-way merge: always include source index in heap tuple to break ties (avoids comparing incomparable objects)",
      "Python heapq = min-heap only. Negate values for max-heap, negate again on pop.",
      "Two heaps median: lower (max-heap) always has same or 1 more element than upper (min-heap)"
    ]
  },
  {
    "id": "slidingwindow",
    "name": "Sliding Window",
    "icon": "⬛",
    "tags": [
      "substring",
      "subarray",
      "variable-window",
      "dedup-stream"
    ],
    "description": "Maintain a window that expands right and contracts from left. Variable window: shrink when condition violated. Common in time-window deduplication and sessionization — knowing this pattern cold matters.",
    "when": [
      "Longest/shortest subarray satisfying a condition",
      "Substring with constraint (at most K distinct, no repeats)"
    ],
    "template": "# Variable window (generic)\nleft = 0\nwindow = {}\nresult = 0\nfor right in range(len(s)):\n    window[s[right]] = window.get(s[right], 0) + 1\n    while not_valid(window):\n        window[s[left]] -= 1\n        if window[s[left]] == 0: del window[s[left]]\n        left += 1\n    result = max(result, right - left + 1)\n\n# Time-window dedup (streaming pattern)\n# events = [(id, timestamp)] sorted by timestamp\nlast_seen = {}  # id -> last accepted timestamp\nresult = []\nfor event_id, ts in events:\n    if event_id not in last_seen or ts - last_seen[event_id] > T:\n        result.append((event_id, ts))\n        last_seen[event_id] = ts\n\n# Sessionization (streaming pattern)\n# events per user, sorted by timestamp\nsessions = []\nif not events: return sessions\nsession_start = events[0][1]\nprev_ts = events[0][1]\nfor _, ts in events[1:]:\n    if ts - prev_ts > G:\n        sessions.append((session_start, prev_ts))\n        session_start = ts\n    prev_ts = ts\nsessions.append((session_start, prev_ts))",
    "keyProblems": [
      {
        "name": "Minimum Window Substring",
        "num": 76,
        "note": "Two freq maps. Track 'formed' count. Hard — know it cold."
      },
      {
        "name": "Longest Substring Without Repeating",
        "num": 3,
        "note": "Set tracks chars. Shrink left while duplicate."
      },
      {
        "name": "Longest Repeating Character Replacement",
        "num": 424,
        "note": "Valid if (windowLen - maxFreq) <= k."
      },
      {
        "name": "Sliding Window Maximum",
        "num": 239,
        "note": "Monotonic deque. Front = current max. Pop smaller from back."
      }
    ],
    "gotchas": [
      "Time-window dedup: if input isn't sorted by timestamp, sort first — O(n log n)",
      "Sessionization: process remaining last session after the loop ends",
      "Min Window Substring: increment 'formed' only when count exactly meets required (not exceeds)"
    ]
  },
  {
    "id": "graphs",
    "name": "Graphs / Union-Find",
    "icon": "⬡",
    "tags": [
      "BFS",
      "DFS",
      "union-find",
      "topological-sort",
      "connected-components"
    ],
    "description": "Graph problems often have a 'scale' twist — high-degree nodes (data skew), large connected components (file metadata graphs), or dependency ordering (job scheduling). Union-Find with path compression is preferred over naive BFS for repeated connectivity queries.",
    "when": [
      "Connected components → Union-Find or BFS/DFS",
      "Cycle detection / dependency order → topological sort",
      "Shortest path (unweighted) → BFS"
    ],
    "template": "# Union-Find (path compression + union by rank)\nparent = list(range(n))\nrank = [0] * n\n\ndef find(x):\n    if parent[x] != x:\n        parent[x] = find(parent[x])  # path compression\n    return parent[x]\n\ndef union(x, y):\n    px, py = find(x), find(y)\n    if px == py: return False  # already connected\n    if rank[px] < rank[py]: px, py = py, px\n    parent[py] = px\n    if rank[px] == rank[py]: rank[px] += 1\n    return True\n\n# Topological sort (Kahn's BFS)\nfrom collections import deque, defaultdict\nin_degree = [0] * n\ngraph = defaultdict(list)\n# build edges...\nqueue = deque(i for i in range(n) if in_degree[i] == 0)\norder = []\nwhile queue:\n    node = queue.popleft()\n    order.append(node)\n    for nei in graph[node]:\n        in_degree[nei] -= 1\n        if in_degree[nei] == 0:\n            queue.append(nei)\n# len(order) != n → cycle exists",
    "keyProblems": [
      {
        "name": "Number of Islands",
        "num": 200,
        "note": "Grid flood fill. Mark visited in-place."
      },
      {
        "name": "Course Schedule",
        "num": 207,
        "note": "Topological sort. len(result)==n → no cycle."
      },
      {
        "name": "Redundant Connection",
        "num": 684,
        "note": "Union-Find. The edge that unions two already-connected nodes is redundant."
      },
      {
        "name": "Evaluate Division",
        "num": 399,
        "note": "Weighted graph BFS. Build graph with a/b and b/a edges."
      }
    ],
    "gotchas": [
      "Union-Find: always use path compression + union by rank together — one alone isn't enough for near-O(1)",
      "Topological sort: if len(result) != n, there's a cycle — return [] or flag accordingly",
      "High-degree nodes: BFS is O(V+E) but E can be huge if one node connects to thousands"
    ]
  },
  {
    "id": "binarysearch",
    "name": "Binary Search",
    "icon": "◑",
    "tags": [
      "sorted",
      "O(log n)",
      "answer-space",
      "monotonic"
    ],
    "description": "Binary search often hides inside non-obvious problems. The advanced form searches on the ANSWER SPACE — binary search on what you're trying to minimize/maximize. Any problem with a monotonic feasibility check is a candidate.",
    "when": [
      "Sorted array lookup / first-last occurrence",
      "Rotated sorted array",
      "Minimize/maximize a value with a feasibility check → search on answer space"
    ],
    "template": "# Standard\nlo, hi = 0, len(arr) - 1\nwhile lo <= hi:\n    mid = lo + (hi - lo) // 2\n    if arr[mid] == target: return mid\n    elif arr[mid] < target: lo = mid + 1\n    else: hi = mid - 1\n\n# Biased left (first occurrence)\nlo, hi = 0, len(arr) - 1\nresult = -1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if arr[mid] == target:\n        result = mid\n        hi = mid - 1  # keep searching left\n    elif arr[mid] < target: lo = mid + 1\n    else: hi = mid - 1\n\n# Answer space (minimize X such that can_do(X) is True)\nlo, hi = min_possible, max_possible\nwhile lo < hi:\n    mid = (lo + hi) // 2\n    if can_do(mid): hi = mid     # mid works, try smaller\n    else: lo = mid + 1\nreturn lo",
    "keyProblems": [
      {
        "name": "Binary Search",
        "num": 704,
        "note": "Nail the template. lo+(hi-lo)//2 avoids overflow."
      },
      {
        "name": "Find First and Last Position",
        "num": 34,
        "note": "Biased-left and biased-right searches."
      },
      {
        "name": "Search in Rotated Sorted Array",
        "num": 33,
        "note": "One half always sorted. Check if target in sorted half."
      },
      {
        "name": "Koko Eating Bananas",
        "num": 875,
        "note": "Answer space. canFinish(speed) monotonic → binary search."
      }
    ],
    "gotchas": [
      "Answer space: `lo < hi` (not <=). hi = mid when feasible, lo = mid+1 when not.",
      "Biased search: getting left vs right wrong is a common fail — practice both variants",
      "can_do must be monotonic: if X works, all X' > X must also work (or vice versa)"
    ]
  },
  {
    "id": "twopointers",
    "name": "Two Pointers",
    "icon": "⇌",
    "tags": [
      "sorted",
      "O(n)",
      "in-place",
      "opposite-ends"
    ],
    "description": "Two pointers moving through a sorted array — either converging from opposite ends or slow/fast pair for in-place operations. Turns O(n²) into O(n) for pair/triplet problems.",
    "when": [
      "Sorted array pair/triplet sum",
      "Palindrome check — converge from ends",
      "Remove/overwrite in-place — slow writes, fast reads",
      "Linked list: cycle detection, midpoint, kth from end"
    ],
    "template": "# Opposite ends (sorted)\nlo, hi = 0, len(arr) - 1\nwhile lo < hi:\n    s = arr[lo] + arr[hi]\n    if s == target: return [lo, hi]\n    elif s < target: lo += 1\n    else: hi -= 1\n\n# Slow / fast (in-place overwrite)\nslow = 0\nfor fast in range(len(arr)):\n    if arr[fast] != val:\n        arr[slow] = arr[fast]\n        slow += 1\nreturn slow  # new length",
    "keyProblems": [
      {
        "name": "3Sum",
        "num": 15,
        "note": "Sort first. Fix one, two-pointer on rest. Skip dupes at ALL 3 levels."
      },
      {
        "name": "Container With Most Water",
        "num": 11,
        "note": "Move the shorter side — taller side can never increase area."
      },
      {
        "name": "Linked List Cycle",
        "num": 141,
        "note": "Floyd's: slow 1 step, fast 2 steps. Meet → cycle."
      },
      {
        "name": "Remove Nth Node From End",
        "num": 19,
        "note": "Gap of n. Dummy head handles removing first node."
      }
    ],
    "gotchas": [
      "3Sum: skip duplicates at outer loop AND both inner pointers after finding a match",
      "`while lo < hi` (not <=) for pair problems — equal pointers = same element",
      "Sort mutates input — check if that's allowed before coding"
    ]
  },
  {
    "id": "stack",
    "name": "Stack / Monotonic Stack",
    "icon": "⧉",
    "tags": [
      "LIFO",
      "next-greater",
      "parentheses",
      "histogram"
    ],
    "description": "Stack for matching/nesting. Monotonic stack maintains always-increasing or always-decreasing order, enabling O(n) solutions for 'next greater/smaller element' problems.",
    "when": [
      "Parentheses / bracket matching",
      "Next greater / smaller element in O(n)",
      "Largest rectangle / trapped water (histogram)"
    ],
    "template": "# Monotonic decreasing (next greater element)\nstack = []  # indices\nresult = [-1] * len(arr)\nfor i, x in enumerate(arr):\n    while stack and arr[stack[-1]] < x:\n        j = stack.pop()\n        result[j] = x\n    stack.append(i)\n\n# Parentheses matching\nstack = []\nmapping = {')': '(', '}': '{', ']': '['}\nfor c in s:\n    if c in mapping:\n        if not stack or stack[-1] != mapping[c]: return False\n        stack.pop()\n    else:\n        stack.append(c)\nreturn not stack",
    "keyProblems": [
      {
        "name": "Valid Parentheses",
        "num": 20,
        "note": "Map closer→opener for clean code."
      },
      {
        "name": "Daily Temperatures",
        "num": 739,
        "note": "Monotonic decreasing stack of indices. result[j] = i - j."
      },
      {
        "name": "Largest Rectangle in Histogram",
        "num": 84,
        "note": "Monotonic increasing stack. Pop when shorter bar found."
      },
      {
        "name": "Min Stack",
        "num": 155,
        "note": "Stack of (val, currentMin) pairs. O(1) getMin."
      }
    ],
    "gotchas": [
      "Store indices in stack (not values) — you need index for distance calculations",
      "After main loop, process remaining stack elements — they have no 'next greater'",
      "Decide increasing vs decreasing: next GREATER → decreasing stack, next SMALLER → increasing stack"
    ]
  },
  {
    "id": "trees",
    "name": "Trees / BFS / DFS",
    "icon": "◬",
    "tags": [
      "recursion",
      "BFS",
      "DFS",
      "level-order"
    ],
    "description": "BFS (queue) for level-order and shortest path. DFS (recursion) for path sums, height, BST validation. Postorder DFS (process children first) for diameter, LCA, and subtree aggregations.",
    "when": [
      "Level-by-level processing → BFS with queue",
      "Path sums, max depth, BST validity → DFS recursion",
      "LCA, diameter → postorder DFS",
      "Grid traversal (islands, walls) → BFS/DFS from each cell"
    ],
    "template": "# BFS level order\nfrom collections import deque\nqueue = deque([root])\nresult = []\nwhile queue:\n    level_size = len(queue)  # snapshot before loop\n    level = []\n    for _ in range(level_size):\n        node = queue.popleft()\n        level.append(node.val)\n        if node.left: queue.append(node.left)\n        if node.right: queue.append(node.right)\n    result.append(level)\n\n# DFS postorder (return value up)\nans = 0\ndef dfs(node):\n    global ans\n    if not node: return 0\n    left = dfs(node.left)\n    right = dfs(node.right)\n    ans = max(ans, left + right)   # use at this node\n    return 1 + max(left, right)    # return up",
    "keyProblems": [
      {
        "name": "Binary Tree Level Order Traversal",
        "num": 102,
        "note": "THE BFS template. level_size = len(queue) before inner loop."
      },
      {
        "name": "Validate BST",
        "num": 98,
        "note": "Pass (min, max) bounds. Each node strictly in (min, max)."
      },
      {
        "name": "Lowest Common Ancestor of BST",
        "num": 235,
        "note": "Both left→go left. Both right→go right. Split→current."
      },
      {
        "name": "Diameter of Binary Tree",
        "num": 543,
        "note": "diameter = left_h + right_h at each node. Track global max."
      }
    ],
    "gotchas": [
      "BST validation: checking only immediate children is WRONG — pass bounds recursively",
      "BFS: capture level_size BEFORE the inner loop, not during",
      "Global max pattern: use nonlocal or class attribute — return value carries height, not the answer"
    ]
  },
  {
    "id": "dp",
    "name": "Dynamic Programming",
    "icon": "⊟",
    "tags": [
      "memoization",
      "bottom-up",
      "1D-dp",
      "2D-dp"
    ],
    "description": "Overlapping subproblems + optimal substructure. Define the state clearly first. 1D DP for linear sequences. 2D DP for two-sequence alignment (LCS, edit distance). Assessments occasionally include DP but it's less common than heaps/graphs.",
    "when": [
      "Optimization (min/max) over a sequence of choices",
      "Counting paths or ways to reach an outcome",
      "Two-sequence alignment (LCS, edit distance)"
    ],
    "template": "# 1D DP (Coin Change)\ndp = [float('inf')] * (amount + 1)\ndp[0] = 0\nfor a in range(1, amount + 1):\n    for coin in coins:\n        if a >= coin:\n            dp[a] = min(dp[a], dp[a - coin] + 1)\n\n# 2D DP (LCS)\nm, n = len(s1), len(s2)\ndp = [[0] * (n + 1) for _ in range(m + 1)]\nfor i in range(1, m + 1):\n    for j in range(1, n + 1):\n        if s1[i-1] == s2[j-1]:\n            dp[i][j] = dp[i-1][j-1] + 1\n        else:\n            dp[i][j] = max(dp[i-1][j], dp[i][j-1])\n\n# Top-down with lru_cache\nfrom functools import lru_cache\n@lru_cache(None)\ndef solve(i, remaining):\n    if remaining == 0: return 0\n    if i == n or remaining < 0: return float('inf')\n    return min(solve(i+1, remaining), 1 + solve(i, remaining - coins[i]))",
    "keyProblems": [
      {
        "name": "House Robber",
        "num": 198,
        "note": "dp[i] = max(dp[i-1], dp[i-2] + nums[i]). Optimize to 2 vars."
      },
      {
        "name": "Coin Change",
        "num": 322,
        "note": "dp[0]=0, rest=inf. Classic unbounded knapsack."
      },
      {
        "name": "Longest Increasing Subsequence",
        "num": 300,
        "note": "O(n²) basic. O(n log n) with patience sort + binary search."
      },
      {
        "name": "Longest Common Subsequence",
        "num": 1143,
        "note": "2D DP template. Match→diagonal+1. No match→max(up, left)."
      }
    ],
    "gotchas": [
      "Define dp[i] meaning explicitly before coding",
      "Init: inf for min problems, -inf/0 for max/count problems",
      "LCS: 1-indexed DP with row/col 0 as base case avoids OOB errors"
    ]
  }
] as const;

export const COMPLEXITY = {
  "dataStructures": [
    {
      "name": "Array",
      "access": "O(1)",
      "search": "O(n)",
      "insert": "O(n)",
      "delete": "O(n)",
      "space": "O(n)",
      "note": "Insert/delete mid = shift. Append amortized O(1)."
    },
    {
      "name": "HashMap",
      "access": "O(1)*",
      "search": "O(1)*",
      "insert": "O(1)*",
      "delete": "O(1)*",
      "space": "O(n)",
      "note": "Amortized. Worst case O(n) with collisions."
    },
    {
      "name": "Stack / Queue",
      "access": "O(n)",
      "search": "O(n)",
      "insert": "O(1)",
      "delete": "O(1)",
      "space": "O(n)",
      "note": "O(1) push/pop. Use collections.deque for queue."
    },
    {
      "name": "Linked List",
      "access": "O(n)",
      "search": "O(n)",
      "insert": "O(1)",
      "delete": "O(1)",
      "space": "O(n)",
      "note": "O(1) only with pointer. Traversal is O(n)."
    },
    {
      "name": "Binary Search Tree",
      "access": "O(log n)",
      "search": "O(log n)",
      "insert": "O(log n)",
      "delete": "O(log n)",
      "space": "O(n)",
      "note": "Balanced only. Unbalanced degrades to O(n)."
    },
    {
      "name": "Heap",
      "access": "O(1) top",
      "search": "O(n)",
      "insert": "O(log n)",
      "delete": "O(log n)",
      "space": "O(n)",
      "note": "Heapify from array: O(n). Python heapq = min-heap."
    },
    {
      "name": "Union-Find",
      "access": "O(α)",
      "search": "O(α)",
      "insert": "O(α)",
      "delete": "N/A",
      "space": "O(n)",
      "note": "With path compression + union by rank. α ≈ O(1) practically."
    },
    {
      "name": "Trie",
      "access": "O(m)",
      "search": "O(m)",
      "insert": "O(m)",
      "delete": "O(m)",
      "space": "O(n·m)",
      "note": "m = key length. 26 children per node for lowercase alpha."
    }
  ],
  "algorithms": [
    {
      "name": "Binary Search",
      "time": "O(log n)",
      "space": "O(1)",
      "note": "Requires sorted/monotonic. Iterative preferred."
    },
    {
      "name": "BFS",
      "time": "O(V + E)",
      "space": "O(V)",
      "note": "Level-by-level. Shortest path in unweighted graph."
    },
    {
      "name": "DFS",
      "time": "O(V + E)",
      "space": "O(V)",
      "note": "Stack depth O(h) for trees, O(V) for graphs."
    },
    {
      "name": "K-way Merge",
      "time": "O(n log K)",
      "space": "O(K)",
      "note": "n total elements across K sorted lists. Core external-sort pattern."
    },
    {
      "name": "Topological Sort",
      "time": "O(V + E)",
      "space": "O(V)",
      "note": "Kahn's BFS or DFS. Empty result = cycle."
    },
    {
      "name": "Dijkstra's",
      "time": "O((V+E) log V)",
      "space": "O(V)",
      "note": "Weighted shortest path. Min-heap."
    },
    {
      "name": "Union-Find ops",
      "time": "O(α(n)) ≈ O(1)",
      "space": "O(n)",
      "note": "With both path compression and union by rank."
    },
    {
      "name": "Quickselect",
      "time": "O(n) avg",
      "space": "O(1)",
      "note": "Kth element. Randomize pivot. Worst O(n²)."
    }
  ],
  "sorting": [
    {
      "name": "QuickSort",
      "avg": "O(n log n)",
      "worst": "O(n²)",
      "space": "O(log n)",
      "stable": "No",
      "note": "Pivot choice matters. Randomized pivot avoids worst case."
    },
    {
      "name": "MergeSort",
      "avg": "O(n log n)",
      "worst": "O(n log n)",
      "space": "O(n)",
      "stable": "Yes",
      "note": "Guaranteed. Good for linked lists and external sort."
    },
    {
      "name": "HeapSort",
      "avg": "O(n log n)",
      "worst": "O(n log n)",
      "space": "O(1)",
      "stable": "No",
      "note": "In-place but not cache-friendly."
    },
    {
      "name": "TimSort (Python)",
      "avg": "O(n log n)",
      "worst": "O(n log n)",
      "space": "O(n)",
      "stable": "Yes",
      "note": "Hybrid merge+insertion. Excellent for nearly-sorted."
    },
    {
      "name": "External MergeSort",
      "avg": "O(n log n)",
      "worst": "O(n log n)",
      "space": "O(B)",
      "stable": "Yes",
      "note": "B = buffer size. Log/file compaction is essentially this."
    },
    {
      "name": "Counting Sort",
      "avg": "O(n + k)",
      "worst": "O(n + k)",
      "space": "O(k)",
      "stable": "Yes",
      "note": "k = value range. Only for small integer ranges."
    }
  ]
} as const;

export const SIGNALS = [
  {
    "icon": "◈",
    "signal": "Scale thinking from the start",
    "detail": "State time AND space complexity proactively. Then go further: 'At 10TB this would need external sort — the k-way merge pattern handles that.' Data-at-scale reasoning is a strong signal.",
    "level": "CRITICAL"
  },
  {
    "icon": "◇",
    "signal": "Clarify before coding",
    "detail": "Ask: Is input sorted? What's the memory budget? Can I modify the input? Are timestamps monotonic? These questions change the entire approach — they reveal you think like a systems engineer.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "△",
    "signal": "State approach, get buy-in",
    "detail": "'I'm thinking a min-heap of size K — O(n log K) time, O(K) space. That fits within memory budget. Does that work before I code?' Never start coding without a verbal commit.",
    "level": "TABLE STAKES"
  },
  {
    "icon": "⚡",
    "signal": "Talk through trade-offs",
    "detail": "For every design choice: what are you giving up? 'Min-heap gives O(n log K) vs O(n log n) for full sort — the trade-off is K extra space. At K=1000 and n=1B rows, that's worthwhile.' Trade-off articulation is weighed heavily.",
    "level": "SENIOR+"
  },
  {
    "icon": "◎",
    "signal": "Production-quality code and edge cases",
    "detail": "OA code may be reviewed in live rounds. Write clean code, name variables well, add a comment for non-obvious invariants. Test: empty input, single element, K > n, duplicate keys, exact boundary timestamps.",
    "level": "SENIOR+"
  },
  {
    "icon": "⬡",
    "signal": "Connect to real-world systems",
    "detail": "When relevant, name the real-world analogue: 'This k-way merge is exactly how log-structured compaction works.' 'This dedup pattern is what streaming exactly-once semantics rely on.' Shows you're not just solving puzzles.",
    "level": "SENIOR+"
  }
] as const;

export const TIME_BUDGET = [
  {
    "phase": "Clarify & Constraints",
    "min": 3,
    "max": 5,
    "tip": "Input format, sorted?, memory budget, scale (n=?), edge cases"
  },
  {
    "phase": "Approach Discussion",
    "min": 3,
    "max": 5,
    "tip": "Brute force → optimal. State complexity. Get buy-in. Mention scale implications."
  },
  {
    "phase": "Code",
    "min": 15,
    "max": 20,
    "tip": "Clean code. Narrate invariants. Avoid silent assumptions."
  },
  {
    "phase": "Test & Debug",
    "min": 5,
    "max": 8,
    "tip": "Dry-run example. Edge: empty, single element, K > n, boundary timestamps."
  },
  {
    "phase": "Scale & Productionize",
    "min": 3,
    "max": 5,
    "tip": "What breaks at 1B rows? Memory constraints? Distributed version? Error handling?"
  }
] as const;

export const META = [
  {
    "icon": "◎",
    "title": "Pattern trigger → approach is the real skill",
    "detail": "See 'merge K sorted sources' → immediately think min-heap. See 'top-K in stream' → min-heap of size K. See 'dedup in time window' → sorted + last_seen map. Build the reflex."
  },
  {
    "icon": "◇",
    "title": "Always articulate the scale implication",
    "detail": "'This is O(n) space — at 1B events that's ~8GB. If that's a problem, I'd switch to a streaming approach with a bounded buffer.' Strong candidates think about memory and I/O cost naturally."
  },
  {
    "icon": "△",
    "title": "K-way merge is their signature pattern",
    "detail": "Understand it deeply: seed heap with one element per source, pop minimum, push next from same source. This is external sort, log compaction, and merge-sort shuffle — all the same idea."
  },
  {
    "icon": "⚡",
    "title": "OA code will be reviewed — write like it",
    "detail": "Interviewers often use your submission as a code sample. Name variables clearly, add a comment for invariants ('lower heap always >= upper'), and handle edge cases explicitly. Don't write throwaway code."
  }
] as const;
