/**
 * Component CSS as a string (rendered through a React 19 hoisted <style>), so the assistant
 * needs no CSS pipeline and works in the public mirror. Everything is scoped under `.nova-*`
 * and themed with CSS variables that have defaults; the site maps them to its own tokens.
 *
 *   --nova-bg --nova-fg --nova-muted --nova-border --nova-accent --nova-accent-fg
 *   --nova-user-bg --nova-user-fg --nova-bot-bg --nova-radius --nova-shadow --nova-font
 *   --nova-z (stacking order of the host wrapper is the host's job)
 */
export const assistantCss = `
.nova-root{--_bg:var(--nova-bg,#ffffff);--_fg:var(--nova-fg,#14161a);--_muted:var(--nova-muted,#5b6270);--_border:var(--nova-border,#dfe3ea);--_accent:var(--nova-accent,#4f46e5);--_accent-fg:var(--nova-accent-fg,#ffffff);--_user-bg:var(--nova-user-bg,var(--_accent));--_user-fg:var(--nova-user-fg,var(--_accent-fg));--_bot-bg:var(--nova-bot-bg,#f1f3f7);--_radius:var(--nova-radius,16px);--_shadow:var(--nova-shadow,0 12px 40px rgba(15,23,42,.22));font-family:var(--nova-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);color:var(--_fg);font-size:14px;line-height:1.45}
@media (prefers-color-scheme:dark){.nova-root{--_bg:var(--nova-bg,#15171c);--_fg:var(--nova-fg,#eceef2);--_muted:var(--nova-muted,#9aa3b2);--_border:var(--nova-border,#2a2f39);--_bot-bg:var(--nova-bot-bg,#222630);--_shadow:var(--nova-shadow,0 12px 40px rgba(0,0,0,.55))}}
.nova-root *,.nova-root *::before,.nova-root *::after{box-sizing:border-box}
.nova-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.nova-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--_border);border-radius:999px;background:var(--_bg);color:var(--_fg);font:inherit;font-weight:600;cursor:pointer;box-shadow:var(--_shadow);white-space:nowrap}
.nova-chip:hover{border-color:var(--_accent)}
.nova-dot{width:8px;height:8px;border-radius:50%;background:var(--_accent);flex:none}
.nova-dot[data-status=thinking],.nova-dot[data-status=streaming]{animation:nova-pulse 1s ease-in-out infinite}
.nova-dot[data-status=error]{background:#dc2626}
.nova-dot[data-status=refused]{background:#d97706}
.nova-panel{display:flex;flex-direction:column;width:min(380px,calc(100vw - 16px));height:var(--nova-h,min(520px,calc(100vh - 16px)));max-height:calc(100dvh - 16px);background:var(--_bg);border:1px solid var(--_border);border-radius:var(--_radius);box-shadow:var(--_shadow);overflow:hidden}
.nova-panel[data-layout=sheet]{width:100%;height:min(60dvh,520px);max-height:var(--nova-avail-h,calc(100dvh - 16px));border-radius:var(--_radius) var(--_radius) 0 0}
@media (max-width:640px){.nova-panel{width:calc(100vw - 16px)}.nova-panel[data-layout=sheet]{width:100%}}
.nova-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--_border)}
.nova-title{display:flex;align-items:center;gap:8px;font-weight:700}
.nova-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--_muted);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.nova-icon-btn:hover{background:var(--_bot-bg);color:var(--_fg)}
.nova-log{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.nova-msg{max-width:88%;padding:8px 12px;border-radius:14px;overflow-wrap:anywhere}
.nova-msg p{margin:0}.nova-msg p+p,.nova-msg ul,.nova-msg ol{margin-top:6px}.nova-msg ul,.nova-msg ol{margin-bottom:0;padding-left:20px}
.nova-msg a{color:inherit;text-decoration:underline}
.nova-msg code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;padding:1px 4px;border-radius:4px;background:rgba(127,127,127,.2)}
.nova-msg[data-role=user]{align-self:flex-end;background:var(--_user-bg);color:var(--_user-fg);border-bottom-right-radius:4px}
.nova-msg[data-role=assistant]{align-self:flex-start;background:var(--_bot-bg);border-bottom-left-radius:4px}
.nova-msg[data-error=true]{border:1px solid #dc2626}
.nova-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.nova-src{display:inline-block;padding:2px 8px;border:1px solid var(--_border);border-radius:999px;font-size:12px;color:var(--_muted);background:var(--_bg);text-decoration:none!important}
a.nova-src:hover{border-color:var(--_accent);color:var(--_fg)}
.nova-starters{display:flex;flex-wrap:wrap;gap:6px}
.nova-starter{padding:6px 10px;border:1px solid var(--_border);border-radius:999px;background:var(--_bg);color:var(--_fg);font:inherit;font-size:13px;cursor:pointer;text-align:left}
.nova-starter:hover{border-color:var(--_accent)}
.nova-typing{display:inline-flex;gap:4px;align-items:center;height:14px}
.nova-typing i{width:6px;height:6px;border-radius:50%;background:var(--_muted);animation:nova-bounce 1.2s ease-in-out infinite}
.nova-typing i:nth-child(2){animation-delay:.15s}.nova-typing i:nth-child(3){animation-delay:.3s}
.nova-retry{margin-top:6px;padding:4px 10px;border:1px solid var(--_border);border-radius:8px;background:var(--_bg);color:var(--_fg);font:inherit;font-size:12px;cursor:pointer}
.nova-form{display:flex;gap:8px;padding:10px 12px 6px;border-top:1px solid var(--_border)}
.nova-input{flex:1;min-width:0;padding:8px 10px;border:1px solid var(--_border);border-radius:10px;background:var(--_bg);color:var(--_fg);font:inherit;font-size:16px}
@media (min-width:641px){.nova-input{font-size:14px}}
.nova-input:focus-visible,.nova-chip:focus-visible,.nova-icon-btn:focus-visible,.nova-starter:focus-visible,.nova-send:focus-visible,.nova-retry:focus-visible,.nova-launcher:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}
.nova-send{padding:0 14px;border:0;border-radius:10px;background:var(--_accent);color:var(--_accent-fg);font:inherit;font-weight:600;cursor:pointer}
.nova-send:disabled{opacity:.5;cursor:not-allowed}
.nova-note{margin:0;padding:0 12px 10px;font-size:11px;color:var(--_muted)}
.nova-launcher{position:fixed;right:16px;bottom:16px;z-index:var(--nova-z,50);display:inline-flex;align-items:center;gap:8px;padding:12px 16px;border:0;border-radius:999px;background:var(--_accent);color:var(--_accent-fg);font:inherit;font-weight:600;cursor:pointer;box-shadow:var(--_shadow)}
.nova-widget{position:fixed;right:16px;bottom:72px;z-index:var(--nova-z,50)}
@media (max-width:640px){.nova-widget{right:8px;left:8px;bottom:68px}.nova-widget .nova-panel{width:100%}}
@keyframes nova-pulse{50%{opacity:.35}}
@keyframes nova-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){.nova-dot,.nova-typing i{animation:none!important}.nova-root *{scroll-behavior:auto!important;transition:none!important}}
`;
