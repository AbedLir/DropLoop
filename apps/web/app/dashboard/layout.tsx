import Link from "next/link";

const links: ReadonlyArray<readonly [label: string, href: string]> = [
  ["Overview", "/dashboard"],
  ["Projects", "/dashboard/projects"],
  ["New Project", "/dashboard/projects/new"],
  ["Generation", "/dashboard/projects/demo/generation"],
  ["Review", "/dashboard/projects/demo/review"],
  ["Loop Doctor", "/dashboard/projects/demo/loop-doctor"],
  ["Stage Preview", "/dashboard/projects/demo/stage-preview"],
  ["Export", "/dashboard/projects/demo/export"],
  ["Billing", "/dashboard/billing"]
];

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">DROPLOOP</div>
        <nav className="nav">
          {links.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
