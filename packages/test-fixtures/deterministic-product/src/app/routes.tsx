export const routes = [
  {
    id: "home",
    name: "Home",
    path: "/",
    screen: "HomeScreen",
  },
  {
    id: "projects",
    name: "Projects",
    path: "/projects",
    screen: "ProjectsScreen",
  },
  {
    id: "settings",
    name: "Settings",
    path: "/settings",
    screen: "SettingsScreen",
  },
] as const;
