import { BrowserRouter, Routes, Route } from "react-router-dom";
import RunTable from "./components/RunTable";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunTable />} />
      </Routes>
    </BrowserRouter>
  );
}
