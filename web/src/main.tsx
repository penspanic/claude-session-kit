import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ThemeProvider } from "./lib/theme";
import { AnalyzePage } from "./pages/AnalyzePage";
import { HomePage } from "./pages/HomePage";
import { PatternsPage } from "./pages/PatternsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SearchPage } from "./pages/SearchPage";
import { SessionPage } from "./pages/SessionPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "p", element: <ProjectPage /> },
      { path: "s", element: <SessionPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "analyze", element: <AnalyzePage /> },
      { path: "patterns", element: <PatternsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
);
