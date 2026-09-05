export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gs-theme";

// Light is the product's default and the only thing an unconfigured visitor
// ever sees. Deliberately NOT seeded from prefers-color-scheme: someone
// whose OS is dark still gets the white app until they ask for otherwise.
export const DEFAULT_THEME: Theme = "light";

// Screens that stay light whatever the stored preference says.
//
// The landing page is the one that was asked for: it is the product's
// shopfront and its whole look is built on a flat white ground.
//
// /login and /register are here for a mechanical reason rather than a
// stylistic one. Both are Clerk's own <SignIn>/<SignUp> widgets, which paint
// their own card and read none of the tokens in globals.css (ClerkProvider
// only hands them colorPrimary and fontFamily). On a dark canvas that card
// would still render white, so the page would be a bright rectangle floating
// on charcoal. Making them light is what keeps them coherent; theming Clerk
// properly would mean pulling in @clerk/themes, which is a bigger change than
// this one is.
const LIGHT_ONLY_PREFIXES = ["/login", "/register"];

export function isLightOnlyRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  // Prefix rather than equality: Clerk's OAuth flow lands on sub-paths of
  // these routes (/login/sso-callback), which are the same screen.
  return LIGHT_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Runs in <head> before the first paint, so a dark-mode user never sees a
// white flash while React hydrates. Kept as a string because that is the
// only way to get code in ahead of the framework; it is deliberately tiny,
// and it duplicates isLightOnlyRoute above rather than importing it because
// nothing is bundled at the point this executes.
//
// Any failure here (Safari private mode throws on localStorage) leaves the
// document exactly as it was, which is light: the safe direction.
export const THEME_INIT_SCRIPT = `(function(){try{var p=location.pathname;var l=p==="/"||["/login","/register"].some(function(x){return p===x||p.indexOf(x+"/")===0});var t=l?"light":(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"?"dark":"light");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`;
