import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { PageLayout } from "@/components/layout/PageLayout";
import { FormRoute } from "@/components/auth/FormRoute";
import { HomePage } from "@/pages/HomePage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";
import { SuccessPage } from "@/pages/SuccessPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { AdminPage } from "@/pages/AdminPage";
import { AttendancePage } from "@/pages/AttendancePage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PageLayout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/form/:formId" element={<FormRoute />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/success" element={<SuccessPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/attendance" element={<AttendancePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </PageLayout>
      </AuthProvider>
    </BrowserRouter>
  );
}
