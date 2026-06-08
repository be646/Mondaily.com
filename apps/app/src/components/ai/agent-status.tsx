import { Link } from "react-router-dom";
import { useUser, useClerk } from "@clerk/react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { MessageCircle, Settings, LogOut, User } from "lucide-react";

export function AgentStatusBar() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="relative flex items-center justify-between border-b border-white/10 bg-[#0d0f13] px-4 py-2">
      <div className="text-xs text-slate-600">AI status: idle</div>

      <div className="flex items-center gap-2">
        {/* Ask Mondaily button */}
        <Link
          to="/ask"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:border-red-500/30 hover:bg-red-500/5 hover:text-white transition-all"
        >
          <MessageCircle size={13} className="text-red-400"/>
          Ask Mondaily
        </Link>

        {/* User avatar */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/20 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
          >
            {initials}
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-white/10 bg-[#161820] shadow-xl">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-medium text-white">{user?.firstName} {user?.lastName}</div>
                <div className="text-xs text-slate-500 truncate">{user?.emailAddresses?.[0]?.emailAddress}</div>
              </div>
              <div className="p-2">
                <Link to="/settings/account" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white">
                  <User size={14}/> Account settings
                </Link>
                <Link to="/settings/workspace" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-white">
                  <Settings size={14}/> Workspace settings
                </Link>
              </div>
              <div className="border-t border-white/10 p-2">
                <button
                  onClick={() => signOut(() => navigate("/sign-in"))}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.04] hover:text-red-400"
                >
                  <LogOut size={14}/> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
