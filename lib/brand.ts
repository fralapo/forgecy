/** Brand preferences are data; font names are notes until a licensed font asset is supplied. */
export function safeHex(value:unknown,fallback:string){return typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback;}
export function rgbFromHex(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255) as [number,number,number];}
function luminance(hex:string){const channels=rgbFromHex(hex).map(v=>v<=0.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
export function brandStyle(profile:Record<string,unknown>|null|undefined){
 const background=safeHex(profile?.brand_background,"#f8fafc");
 const preferred=safeHex(profile?.brand_primary,"#475569");
 const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const text=contrast(preferred,background)>=4.5?preferred:contrast("#17251e",background)>contrast("#ffffff",background)?"#17251e":"#ffffff";
 return {background,text,primary:preferred,headingFont:typeof profile?.heading_font==="string"?profile.heading_font.slice(0,100):""};
}
