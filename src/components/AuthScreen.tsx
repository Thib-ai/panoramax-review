import { Image, Lock, AlertCircle } from 'lucide-react';

interface AuthScreenProps {
  error?: string;
}

export default function AuthScreen({ error }: AuthScreenProps) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 flex flex-col justify-center items-center px-4 py-8 select-none font-sans">
      <div className="max-w-md space-y-6 w-full">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-slate-900 text-white rounded-2xl shadow-sm mb-1">
            <Image className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Panoramax Review</h1>
          <p className="text-slate-500 text-xs sm:text-sm max-w-xs mx-auto leading-relaxed">
            Mobile-friendly review tool for Panoramax street-level imagery.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="text-center">
            <h2 className="text-sm font-semibold text-slate-800">Authentication Required</h2>
            <p className="text-xs text-slate-500 mt-1">You must be logged into YunoHost to access this app.</p>
          </div>

          <a
            href="/yunohost/sso/?r=/"
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl border border-slate-700 shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <Lock className="w-4 h-4" />
            Log in via YunoHost
          </a>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <p className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Restricted access &bull; YunoHost SSO
          </p>
        </div>

        <p className="text-center text-xs text-slate-400">Panoramax Open Imagery Spec</p>
      </div>
    </div>
  );
}
