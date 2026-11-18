import { Routes, Route, Navigate } from "react-router-dom";
import {
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  useAuth,
} from "@clerk/clerk-react";
import { Toaster } from "react-hot-toast";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/Home.tsx";
import { EditorPage } from "./pages/Editor.tsx";
import { DashboardPage } from "./pages/Dashboard.tsx";

export function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "oklch(0.18 0.005 285)",
            color: "oklch(0.93 0.005 285)",
            border: "1px solid oklch(0.30 0.005 285)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.8125rem",
          },
        }}
      />
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/editor/:streamId" element={<EditorPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </SignedIn>
    </>
  );
}
