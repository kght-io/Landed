# Architecture diagram

<!-- AUTO-GENERATED — do not edit by hand. Run `npm run diagram:arch` to regenerate. Source of truth: the import graph itself. -->

High-level module dependency graph, collapsed to one box per workspace sub-folder
(`frontend/*`, `backend/src/*`, `shared/src/*`). An arrow means "imports from".

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
5["fitlab"]
6["gmail.ts"]
7["jobs"]
8["logs"]
9["onboarding.ts"]
A["paths.ts"]
B["peercomp"]
C["prep"]
D["threads.ts"]
end
end
subgraph E["frontend"]
F["app"]
G["components"]
H["global.d.ts"]
I["hooks"]
J["instrumentation.ts"]
K["lib"]
L["next-env.d.ts"]
M["pendo.d.ts"]
end
N["mcp"]
subgraph O["shared"]
subgraph P["src"]
Q["agents"]
R["config"]
S["db"]
T["format"]
U["jobs"]
V["onboarding.ts"]
W["pipeline"]
X["prep"]
Y["resume"]
Z["types.ts"]
10["util"]
end
end
2-->3
2-->A
2-->4
2-->Q
2-->T
2-->W
3-->A
4-->A
4-->S
4-->Q
4-->R
4-->T
4-->U
4-->W
4-->Z
4-->X
4-->10
5-->4
6-->4
7-->4
7-->W
7-->Q
7-->U
7-->Z
7-->2
7-->B
7-->C
7-->10
7-->3
9-->3
9-->4
9-->6
9-->V
B-->4
B-->C
B-->Q
C-->3
C-->4
C-->Z
D-->4
F-->G
F-->2
F-->A
F-->C
F-->7
F-->Q
F-->4
F-->Z
F-->3
F-->6
F-->R
F-->K
F-->9
F-->10
F-->5
F-->D
F-->X
G-->I
G-->T
G-->Q
G-->7
G-->K
G-->Z
G-->4
G-->V
G-->2
G-->R
G-->U
G-->W
G-->10
G-->X
I-->W
I-->Z
I-->4
I-->U
J-->7
K-->N
Q-->R
Q-->Z
Q-->4
Q-->10
T-->W
T-->Z
U-->Z
U-->10
U-->Q
W-->Z
X-->Z
X-->4
Z-->R
Z-->10
```
