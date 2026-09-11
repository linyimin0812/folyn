import { createRoot } from 'react-dom/client';
import { DbmlPreview } from './DbmlPreview';

const root = document.getElementById('root');
if (root) createRoot(root).render(<DbmlPreview />);
