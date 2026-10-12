import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={
 title:"Forgecy · Creative workspace",
 description:"Client intelligence, strategy and creative work, coordinated by AI."
};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="it"><body>{children}</body></html>;
}
