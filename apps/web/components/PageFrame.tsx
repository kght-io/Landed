// Every page fills the available width — on a bigger screen the page itself gets bigger, with no
// centered side gutters boxing it in. Content that should stay readable is capped per-view (each
// view wraps its body in its own `mx-auto max-w-*`), so widening the page never widens the elements.
export default function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full overflow-hidden">{children}</div>;
}
