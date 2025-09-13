import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Shield, ArrowLeft } from 'lucide-react';

interface OTPVerificationProps {
  phoneNumber: string;
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  isLoading?: boolean;
  error?: string;
}

export function OTPVerification({
  phoneNumber,
  onVerify,
  onBack,
  isLoading = false,
  error,
}: OTPVerificationProps) {
  const [code, setCode] = useState('');

  useEffect(() => {
    if (code.length === 6) {
      handleVerify();
    }
  }, [code]);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    
    try {
      await onVerify(code);
    } catch (err) {
      console.error('OTP verification error:', err);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center shadow-lg">
          <Shield className="h-8 w-8 text-accent-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Pokédex Call Center
          </h1>
          <h2 className="text-lg font-semibold text-foreground mt-1">Verify Your Phone</h2>
        </div>
        <p className="text-muted-foreground">
          We sent a 6-digit code to{' '}
          <span className="font-medium text-foreground">{phoneNumber}</span>
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={isLoading}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Enter the 6-digit verification code
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <Button 
            onClick={handleVerify} 
            className="w-full bg-gradient-to-r from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-accent-foreground shadow-lg" 
            disabled={isLoading || code.length !== 6}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify Code'
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            className="w-full"
            disabled={isLoading}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Phone Entry
          </Button>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Didn't receive a code?{' '}
          <Button variant="link" className="p-0 h-auto font-medium" onClick={onBack}>
            Try different number
          </Button>
        </p>
      </div>
    </div>
  );
}