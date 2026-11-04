import wordmark from '../assets/ally-ahead-wordmark.webp';
import { AppLink } from '../app/router';
export function Brand(){return <AppLink className="brand" href="/" aria-label="Ally Ahead"><img src={wordmark} alt="Ally Ahead"/></AppLink>;}
