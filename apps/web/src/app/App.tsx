import {lazy,Suspense,useEffect} from 'react';
import {useRoute,navigate} from './router';
import {useLocale} from '../locales/context';
import {Loading} from '../components/Feedback';
import {ReceptionTransition} from '../pages/reception/ReceptionTransition';
const Homepage=lazy(()=>import('../pages/homepage/Homepage').then(m=>({default:m.Homepage})));
const Reception=lazy(()=>import('../pages/reception/PublicReceptionPage'));
export function App(){const route=useRoute().split('?')[0];const {locale,setLocale}=useLocale();useEffect(()=>{if(!['/','/reception','/start'].includes(route!))navigate('/reception',true);document.title='Ally Ahead';document.documentElement.lang=locale==='zh'?'zh-CN':'en';},[route,locale]);return <Suspense fallback={<Loading/>}>{route==='/'?<Homepage poc locale={locale} onLocaleChange={setLocale} onStart={()=>navigate('/reception')} onLogin={()=>navigate('/reception')} onProvider={()=>navigate('/reception')}/>:<ReceptionTransition><Reception/></ReceptionTransition>}</Suspense>;}