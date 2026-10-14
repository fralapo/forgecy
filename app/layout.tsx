import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={
 title:"Forgecy · Creative workspace",
 description:"Client intelligence, strategy and creative work, coordinated by AI."
};
export default function RootLayout({children}:{children:React.ReactNode}){
 // Browsers can inject root-level attributes before React hydrates the page.
 return <html lang="it" suppressHydrationWarning><body>{children}</body></html>;
}
