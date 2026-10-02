import '@backstage/cli/asset-types';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@backstage/ui/css/styles.css';
// After BUI's own, so its font follows the MUI theme's.
import './bui-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
