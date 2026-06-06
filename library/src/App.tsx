import { BrowserRouter, Routes, Route } from "react-router-dom";
import RunTable from "./components/RunTable";
import RunDetail from "./components/RunDetail";
import ComparePage from "./components/ComparePage";
import AboutPage from "./components/AboutPage";
import OperationsPage from "./components/OperationsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunTable />} />
        <Route path="/run/:run_id" element={<RunDetail />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/operations" element={<OperationsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
