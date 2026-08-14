import { ServingPage } from './pages/serving/ServingPage';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  return <ServingPage theme={theme} onToggleTheme={toggleTheme} />;
}