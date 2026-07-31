import { FolderOpen, Mail } from "lucide-react";
import GmailConnect from "@/components/GmailConnect";
import AssetFolderInfo from "@/components/settings/AssetFolderInfo";
import InboxSyncSettings from "@/components/settings/InboxSyncSettings";
import SettingsCard from "@/components/settings/SettingsCard";

export const dynamic = "force-dynamic";

// App/system config: external connections and the asset folder the app + agent share. Your candidate
// identity (profile, leveling, résumé) lives on /profile.
export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
          <p className="mt-1 text-[13px] text-zinc-500">Connections and the asset folder the app and agent share.</p>
        </header>

        <div className="space-y-5">
          <GmailConnect />

          <SettingsCard
            icon={<Mail size={17} />}
            accent="sky"
            title="Inbox sync"
            description="How your inbox is synced into the pipeline — statuses, interview rounds, and dates."
          >
            <InboxSyncSettings />
          </SettingsCard>

          <SettingsCard
            icon={<FolderOpen size={17} />}
            accent="sky"
            title="Asset folder"
            description="Where the app and agent share files — résumé, interview-prep, and tailored resumes."
          >
            <AssetFolderInfo />
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
