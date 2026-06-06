import { BrowserRouter, Routes, Route } from "react-router-dom";
import RunTable from "./components/RunTable";
import RunDetail from "./components/RunDetail";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunTable />} />
        <Route path="/run/:run_id" element={<RunDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
