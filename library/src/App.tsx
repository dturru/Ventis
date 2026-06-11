import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Header, Footer } from "./components/Header";
import RunTable from "./components/RunTable";
import RunDetail from "./components/RunDetail";
import ComparePage from "./components/ComparePage";
import CoveragePage from "./components/CoveragePage";
import AboutPage from "./components/AboutPage";
import OperationsPage from "./components/OperationsPage";
import DeployPage from "./components/DeployPage";
import CuratePage from "./components/CuratePage";

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<RunTable />} />
        <Route path="/run/:run_id" element={<RunDetail />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/coverage" element={<CoveragePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/operations" element={<OperationsPage />} />
        <Route path="/deploy" element={<DeployPage />} />
        <Route path="/curate" element={<CuratePage />} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}
