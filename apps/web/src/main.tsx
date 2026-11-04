import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from './locales/context';
import { SessionProvider } from './app/session';
import { App } from './app/App';
import { ConsultationOpsRoute } from './pages/ops/ConsultationOpsRoute';
import './app/app.css';

createRoot(document.getElementById('root')!).render(<StrictMode><LocaleProvider><SessionProvider><ConsultationOpsRoute><App/></ConsultationOpsRoute></SessionProvider></LocaleProvider></StrictMode>);
