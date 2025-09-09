import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { apiCall, FetchError } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import type { VerificationResponse } from '@/lib/types';

interface SendVerificationParams {
  phoneNumber: string;
}

interface VerifyCodeParams {
  phoneNumber: string;
  code: string;
}

export function usePhoneVerification() {
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isCodeSent, setIsCodeSent] = useState(false);

  const sendVerificationMutation = useMutation({
    mutationFn: ({ phoneNumber }: SendVerificationParams) =>
      apiCall('/api/auth/send-verification', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      }),
    onSuccess: () => {
      setIsCodeSent(true);
    },
    onError: (error) => {
      console.error('Send verification error:', error);
    },
  });

  const verifyCodeMutation = useMutation({
    mutationFn: ({ phoneNumber, code }: VerifyCodeParams) =>
      apiCall<VerificationResponse>('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, code }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
      setIsCodeSent(false);
      setPhoneNumber('');
    },
    onError: (error) => {
      console.error('Verify code error:', error);
    },
  });

  const validatePhoneNumber = (phone: string): string | null => {
    try {
      if (!phone) return 'Phone number is required';
      
      // Try to parse as international first, then default to US
      let isValid = false;
      let parsed = null;
      
      if (phone.startsWith('+')) {
        isValid = isValidPhoneNumber(phone);
        parsed = parsePhoneNumber(phone);
      } else {
        // For numbers without country code, assume US
        isValid = isValidPhoneNumber(phone, 'US');
        parsed = parsePhoneNumber(phone, 'US');
      }
      
      if (!isValid || !parsed) {
        return 'Please enter a valid phone number (US: 10 digits, International: +country code)';
      }
      
      return null;
    } catch (error) {
      return 'Invalid phone number format';
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    try {
      let parsed = null;
      
      if (phone.startsWith('+')) {
        parsed = parsePhoneNumber(phone);
      } else {
        // For numbers without country code, assume US
        parsed = parsePhoneNumber(phone, 'US');
      }
      
      return parsed ? parsed.formatInternational() : phone;
    } catch {
      return phone;
    }
  };

  const sendVerification = async (phone: string) => {
    const validation = validatePhoneNumber(phone);
    if (validation) {
      throw new Error(validation);
    }

    const formatted = formatPhoneNumber(phone);
    setPhoneNumber(formatted);
    
    return sendVerificationMutation.mutateAsync({
      phoneNumber: formatted,
    });
  };

  const verifyCode = async (code: string) => {
    if (!phoneNumber) {
      throw new Error('Phone number not set');
    }

    if (!code || code.length !== 6) {
      throw new Error('Please enter a valid 6-digit code');
    }

    return verifyCodeMutation.mutateAsync({
      phoneNumber,
      code,
    });
  };

  const reset = () => {
    setPhoneNumber('');
    setIsCodeSent(false);
    sendVerificationMutation.reset();
    verifyCodeMutation.reset();
  };

  return {
    phoneNumber,
    isCodeSent,
    sendVerification,
    verifyCode,
    reset,
    validatePhoneNumber,
    formatPhoneNumber,
    isSending: sendVerificationMutation.isPending,
    isVerifying: verifyCodeMutation.isPending,
    sendError: sendVerificationMutation.error as FetchError | null,
    verifyError: verifyCodeMutation.error as FetchError | null,
  };
}