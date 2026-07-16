import Link from "next/link";
import { signOut } from "../auth/actions";

export const dynamic = "force-dynamic";

const links: ReadonlyArray<readonly [label: string, href: string]> = [
  ["Overview", "/dashboard"],
  ["Projects", "/dashboard/projects"],
  ["New Project", "/dashboard/projects/new"],
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
        <form action={signOut} className="sidebarFooter">
          <button className="button" type="submit">
            Sign out
          </button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
