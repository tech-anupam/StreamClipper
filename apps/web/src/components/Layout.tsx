import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserButton } from "@clerk/clerk-react";
import { cn } from "../lib/utils.ts";

const NAV_ITEMS = [
  { path: "/", label: "NEW" },
  { path: "/dashboard", label: "STREAMS" },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-surface-0 flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface-1 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="font-mono font-bold text-sm tracking-wider text-accent"
          >
            STREAMCLIPPER
          </Link>
          <nav className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono tracking-wide transition-colors",
                  location.pathname === item.path
                    ? "bg-surface-2 text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-2/50"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-text-muted tracking-widest">
            v0.1.0
          </span>
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-7 h-7",
              },
            }}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">{children}</main>

      {/* Footer note */}
      <footer className="border-t border-border px-4 py-1.5 text-center">
        <p className="text-[10px] font-mono text-text-muted tracking-wide">
          Only clip streams you own or have permission to clip.
        </p>
      </footer>
    </div>
  );
}
