import type { Metadata } from "next";
import "./globals.css";
import { Geist, Instrument_Serif, Caveat, Pixelify_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Reserved for marketing surfaces (landing hero, auth panel) and the odd
// large numeral -- deliberately never used for app UI, where a serif at
// small sizes costs legibility and gains nothing.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
});

// One handwritten accent on the landing hero. Loaded here so next/font
// self-hosts and preloads it like the others rather than pulling a
// render-blocking stylesheet at runtime.
const caveat = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-hand" });

// Bitmap accent for the one contrast word in the landing headline.
const pixelify = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pixel" });

export const metadata: Metadata = {
  title: "GettingShortlisted.com",
  description: "Never miss a relevant job opening from the companies you care about.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable, instrumentSerif.variable, caveat.variable, pixelify.variable)}
    >
      <body>
        <ClerkProvider
          appearance={{
            variables: { colorPrimary: "var(--brand)", fontFamily: "var(--font-sans)" },
          }}
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ClerkProvider>
      </body>
    </html>
  );
}
