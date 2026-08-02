export const flows = [
  {
    "id": "primary-navigation",
    "name": "Primary navigation",
    "provenance": "declared",
    "steps": [
      {
        "order": 1,
        "route": "home",
        "state": "default",
        "trigger": "flow-start",
        "assertion": "home-screen-visible"
      },
      {
        "order": 2,
        "route": "projects",
        "state": "default",
        "trigger": "open-projects",
        "assertion": "projects-screen-visible"
      },
      {
        "order": 3,
        "route": "settings",
        "state": "default",
        "trigger": "open-settings",
        "assertion": "settings-screen-visible"
      }
    ]
  }
] as const;
