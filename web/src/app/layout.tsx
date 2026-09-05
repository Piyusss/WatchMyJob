import type { Metadata } from "next";
import "./globals.css";
import { Geist, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import ThemeProvider from "@/components/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Reserved for the odd display line (see StatusScreen): deliberately
// never used for app UI, where a serif at small sizes costs legibility and
// gains nothing.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "WatchmyJob.co",
  description:
    "Get instant email alerts when a new job matching your preferences goes live so you can apply early before the crowd.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because the script below adds a class to this
    // exact element before React ever sees it, which is otherwise reported as
    // server/client markup drift. It covers this element only, not the tree.
    <html
      lang="en"
      className={cn("font-sans", geist.variable, instrumentSerif.variable)}
      suppressHydrationWarning
    >
      <head>
        {/* Ahead of first paint, so a dark-mode user never gets a white
            flash before hydration. Nothing else may run before this. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ClerkProvider
          appearance={{
            variables: { colorPrimary: "var(--brand)", fontFamily: "var(--font-sans)" },
          }}
        >
          <ThemeProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
