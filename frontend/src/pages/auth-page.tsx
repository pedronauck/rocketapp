import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { PhoneNumberInput } from '@/components/auth/phone-number-input';
import { OTPVerification } from '@/components/auth/otp-verification';
import { usePhoneVerification } from '@/hooks/use-phone-verification';
import { useAuth } from '@/contexts/auth-context';

export function AuthPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const {
    phoneNumber,
    isCodeSent,
    sendVerification,
    verifyCode,
    reset,
    validatePhoneNumber,
    formatPhoneNumber,
    isSending,
    isVerifying,
    sendError,
    verifyError,
  } = usePhoneVerification();

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handlePhoneSubmit = async (phone: string) => {
    try {
      await sendVerification(phone);
      toast.success('Verification code sent!', {
        description: 'Check your phone for the 6-digit code.',
      });
    } catch (error) {
      toast.error('Failed to send code', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const handleCodeVerify = async (code: string) => {
    try {
      await verifyCode(code);
      toast.success('Successfully signed in!');
      // Redirect to dashboard after successful authentication
      navigate('/', { replace: true });
    } catch (error) {
      toast.error('Verification failed', {
        description: error instanceof Error ? error.message : 'Please check your code and try again.',
      });
    }
  };

  const handleBack = () => {
    reset();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card/80 backdrop-blur-sm rounded-2xl p-8 border border-border/50 shadow-2xl">
        {!isCodeSent ? (
          <PhoneNumberInput
            onSubmit={handlePhoneSubmit}
            isLoading={isSending}
            error={sendError?.body?.message}
            validatePhoneNumber={validatePhoneNumber}
            formatPhoneNumber={formatPhoneNumber}
          />
        ) : (
          <OTPVerification
            phoneNumber={phoneNumber}
            onVerify={handleCodeVerify}
            onBack={handleBack}
            isLoading={isVerifying}
            error={verifyError?.body?.message}
          />
        )}
      </div>
    </div>
  );
}