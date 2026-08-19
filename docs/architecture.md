# Architecture diagram

<!-- AUTO-GENERATED — do not edit by hand. Regenerated on every push by
     .github/workflows/architecture-diagram.yml. Run `npm run diagram:arch` to regenerate. Source of truth: the import graph itself. -->

High-level module dependency graph, collapsed to one box per workspace sub-folder
(`frontend/*`, `backend/src/*`, `shared/src/*`, `desktop/src/*`). An arrow means "imports from".

This is generated from the real import graph, so it is always correct and hard to read — use it
to spot structural drift in a diff. For orientation, read the hand-written
[overview](overview.md) instead.

```mermaid
flowchart LR

subgraph 0["backend"]
subgraph 1["src"]
2["agents"]
3["config.ts"]
4["db"]
5["env.ts"]
6["fitlab"]
7["gmail.ts"]
8["jobs"]
9["logs"]
A["onboarding.ts"]
B["paths.ts"]
C["peercomp"]
D["prep"]
E["threads.ts"]
end
end
subgraph F["frontend"]
G["app"]
H["components"]
I["global.d.ts"]
J["hooks"]
K["instrumentation.ts"]
L["lib"]
M["next-env.d.ts"]
N["pendo.d.ts"]
end
O["mcp"]
subgraph P["shared"]
subgraph Q["src"]
R["agents"]
S["config"]
T["db"]
U["desktop"]
V["experiments"]
W["format"]
X["jobs"]
Y["mcp"]
Z["onboarding.ts"]
10["pipeline"]
11["prep"]
12["resume"]
13["types.ts"]
14["util"]
end
end
2-->3
2-->B
2-->4
2-->R
2-->W
2-->10
3-->5
3-->B
4-->3
4-->B
4-->T
4-->10
4-->13
4-->R
4-->S
4-->W
4-->X
4-->V
4-->11
4-->14
6-->4
7-->4
8-->4
8-->10
8-->R
8-->X
8-->13
8-->T
8-->2
8-->C
8-->D
8-->14
8-->3
A-->3
A-->4
A-->7
A-->Z
C-->4
D-->4
D-->13
D-->3
D-->R
E-->4
G-->H
G-->2
G-->B
G-->D
G-->8
G-->R
G-->4
G-->13
G-->3
G-->7
G-->S
G-->L
G-->A
G-->T
G-->14
G-->6
G-->E
G-->11
H-->J
H-->R
H-->W
H-->8
H-->L
H-->13
H-->4
H-->V
H-->Z
H-->2
H-->S
H-->X
H-->10
H-->11
H-->14
H-->T
J-->10
J-->13
J-->4
J-->X
K-->8
L-->Y
L-->U
L-->14
O-->Y
R-->S
R-->13
R-->4
R-->14
V-->T
W-->10
W-->13
X-->13
X-->14
X-->R
X-->T
10-->13
11-->10
11-->13
11-->4
13-->S
13-->14
```
