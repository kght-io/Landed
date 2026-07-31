import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import NavRail from "@/components/NavRail";
import PageFrame from "@/components/PageFrame";
import AgentQueueProvider from "@/components/AgentQueueProvider";
import AgentChatsProvider from "@/components/AgentChatsProvider";
import AddJobProvider from "@/components/AddJobProvider";
import FloatingQueue from "@/components/FloatingQueue";
import AutoWorkController from "@/components/AutoWorkController";
import GetStartedChecklist from "@/components/GetStartedChecklist";
import PendoInitializer from "@/components/PendoInitializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Landed",
  description: "Discovery → fit → tailor → apply, in one cockpit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`light ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Optional product analytics. The stub (window.pendo with queued no-op methods) is always
            defined so pendo.* calls never throw; the real agent is only fetched when you set
            NEXT_PUBLIC_PENDO_KEY to your own Pendo key. Unset (the default) ships no analytics —
            contributors' usage isn't tracked and no data leaves the browser. */}
        <Script id="pendo-install" strategy="afterInteractive">{`
(function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
v=['initialize','identify','updateOptions','pageLoad','track','trackAgent'];for(w=0,x=v.length;w<x;++w)(function(m){
o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
var k=${JSON.stringify(process.env.NEXT_PUBLIC_PENDO_KEY || "")};
if(k){y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+k+'/pendo.js';
z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);}})(window,document,'script','pendo');
`}</Script>
      </head>
      <body className="flex h-screen overflow-hidden">
        <PendoInitializer />
        <AgentQueueProvider>
          <AgentChatsProvider>
            <AddJobProvider>
              <NavRail />
              <div className="flex-1 overflow-hidden"><PageFrame>{children}</PageFrame></div>
              <FloatingQueue />
              <AutoWorkController />
              <GetStartedChecklist />
            </AddJobProvider>
          </AgentChatsProvider>
        </AgentQueueProvider>
      </body>
    </html>
  );
}
