// esbuild entry point. Importing the shell pulls in every child component via
// its own side-effecting `@customElement` registration, producing one bundle
// that defines <boat-management-panel> for Home Assistant to mount.
import "./boat-panel";
