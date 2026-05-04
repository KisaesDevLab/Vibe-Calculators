import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HealthPage } from "@/pages/Health";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/health" replace />} />
        <Route path="/health" element={<HealthPage />} />
      </Routes>
    </BrowserRouter>
  );
}
