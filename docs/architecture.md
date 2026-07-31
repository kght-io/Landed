# Architecture diagram

<!-- AUTO-GENERATED — do not edit by hand. Regenerated on every push by
     .github/workflows/architecture-diagram.yml. Run `npm run diagram:arch` to regenerate. Source of truth: the import graph itself. -->

High-level module dependency graph, collapsed to one box per workspace sub-folder
(`apps/web/*`, `packages/core/src/*`, `packages/shared/src/*`). An arrow means "imports from".

```mermaid
flowchart LR

subgraph 0["apps"]
subgraph 1["mcp"]
2["jobhunt-server.mjs"]
end
subgraph 3["web"]
4["app"]
5["components"]
6["global.d.ts"]
7["hooks"]
8["lib"]
9["next-env.d.ts"]
A["pendo.d.ts"]
end
end
subgraph B["packages"]
subgraph C["core"]
subgraph D["src"]
E["agents"]
F["config.ts"]
G["db"]
H["fitlab"]
I["gmail.ts"]
J["jobs"]
K["onboarding.ts"]
L["paths.ts"]
M["peercomp"]
N["prep"]
O["threads.ts"]
end
end
subgraph P["shared"]
subgraph Q["src"]
R["agents"]
S["board.ts"]
T["change-format.ts"]
U["coerce.ts"]
V["csv.ts"]
W["db"]
X["discovery.ts"]
Y["fitlab"]
Z["format.ts"]
10["inbox-schedule.ts"]
11["interview-loop.ts"]
12["jobs"]
13["leveling.ts"]
14["linediff.ts"]
15["onboarding-shared.ts"]
16["pipeline.ts"]
17["prep"]
18["resume"]
19["targets.mjs"]
1A["types.ts"]
end
end
end
4-->5
4-->E
4-->L
4-->N
4-->J
4-->R
4-->G
4-->1A
4-->F
4-->H
4-->Y
4-->I
4-->13
4-->8
4-->K
4-->14
4-->O
4-->17
5-->7
5-->Z
5-->R
5-->8
5-->T
5-->1A
5-->G
5-->Y
5-->15
5-->S
5-->X
5-->10
5-->12
5-->13
5-->16
5-->11
5-->14
5-->17
7-->S
7-->16
7-->1A
7-->G
7-->12
8-->2
E-->F
E-->L
E-->G
E-->J
E-->R
E-->T
E-->16
F-->L
G-->L
G-->W
G-->R
G-->U
G-->17
G-->J
G-->T
G-->12
G-->13
G-->16
G-->1A
H-->R
H-->U
H-->Y
H-->12
H-->G
H-->J
I-->G
J-->E
J-->G
J-->H
J-->M
J-->N
J-->R
J-->U
J-->12
J-->14
J-->1A
J-->F
J-->16
K-->F
K-->G
K-->I
K-->15
M-->G
M-->N
M-->R
N-->F
N-->G
N-->1A
O-->G
R-->19
R-->1A
R-->G
R-->U
S-->16
S-->1A
T-->16
T-->1A
11-->1A
12-->14
12-->1A
12-->R
12-->U
16-->1A
17-->1A
17-->G
1A-->13
1A-->14
```
